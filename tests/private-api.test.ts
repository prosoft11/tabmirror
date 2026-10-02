import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest, type Server } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import {
  createPrivateApi,
  type PrivateApiOptions,
} from '../apps/api/src/private-api';
import { SqlitePrivateStore } from '../apps/api/src/sqlite-store';
import { digest } from '../apps/api/src/private-store';
import { makeFixture } from '../packages/contracts/src/fixtures';

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function setup(rateLimit = 120) {
  const directory = mkdtempSync(join(tmpdir(), 'tabmirror-private-'));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'private.sqlite');
  let now = Date.parse('2026-09-23T12:00:00Z');
  const clock = () => now;
  let store = new SqlitePrivateStore(path, clock);
  cleanups.push(() => store.close());
  const daniel = store.provision('daniel'),
    farris = store.provision('farris');
  const logs: unknown[] = [];
  const options: PrivateApiOptions = {
    allowedHosts: [],
    viewerOrigin: 'http://127.0.0.1:4317',
    extensionOrigin: /^chrome-extension:\/\/[a-p]{32}$/,
    rateLimit,
    clock,
    log: (event) => logs.push(event),
  };
  let server: Server;
  let base: string;
  const start = async () => {
    server = createPrivateApi(store, options);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('address');
    options.allowedHosts = [`127.0.0.1:${address.port}`];
    base = `http://${options.allowedHosts[0]}`;
  };
  const stop = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  await start();
  cleanups.push(stop);
  const request = (
    token: string,
    route: string,
    method = 'GET',
    value?: unknown,
    extra: Record<string, string> = {},
  ) =>
    fetch(`${base}${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...extra,
      },
      body: value === undefined ? undefined : JSON.stringify(value),
    });
  return {
    daniel,
    farris,
    request,
    logs,
    path,
    get store() {
      return store;
    },
    get base() {
      return base;
    },
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
    restart: async () => {
      await stop();
      store.close();
      store = new SqlitePrivateStore(path, clock);
      await start();
    },
  };
}
const uploadPath = '/api/device/snapshot';
it('persists complete snapshots and hashed credentials across process-store restart', async () => {
  const app = await setup(),
    snapshot = makeFixture('mixed');
  const { deviceToken, viewerToken, deviceId } = app.daniel;
  expect(
    (await app.request(deviceToken, uploadPath, 'PUT', snapshot)).status,
  ).toBe(200);
  await app.restart();
  const response = await app.request(
    viewerToken,
    `/api/devices/${deviceId}/snapshot`,
  );
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect((await response.json()).snapshot).toEqual(snapshot);
  expect(
    await app.request(deviceToken, '/api/device/status').then((r) => r.json()),
  ).toEqual({ revision: snapshot.revision });
  const bytes = readFileSync(app.path);
  expect(bytes.includes(Buffer.from(deviceToken))).toBe(false);
  expect(bytes.includes(Buffer.from(viewerToken))).toBe(false);
  expect(statSync(app.path).mode & 0o777).toBe(0o600);
});
it('enforces viewer/device scopes and owner isolation for reads, lists, revoke, delete and uploads', async () => {
  const app = await setup(),
    { viewerToken, deviceToken, deviceId } = app.daniel;
  for (const [route, method] of [
    [`/api/devices/${deviceId}/snapshot`, 'GET'],
    [`/api/devices/${deviceId}/revoke`, 'POST'],
    [`/api/devices/${deviceId}`, 'DELETE'],
  ])
    expect(
      (await app.request(app.farris.viewerToken, route!, method)).status,
    ).toBe(404);
  expect((await app.request(deviceToken, '/api/devices')).status).toBe(401);
  expect(
    (await app.request(deviceToken, `/api/devices/${deviceId}/snapshot`))
      .status,
  ).toBe(401);
  expect(
    (await app.request(viewerToken, uploadPath, 'PUT', makeFixture('mixed')))
      .status,
  ).toBe(401);
  expect(
    (
      await app.request(deviceToken, uploadPath, 'PUT', {
        ...makeFixture('mixed'),
        ownerId: 'farris',
      })
    ).status,
  ).toBe(400);
  const list = await app
    .request(viewerToken, '/api/devices')
    .then((r) => r.json());
  expect(list.devices.map((d: { id: string }) => d.id)).toEqual([deviceId]);
  expect((await app.request('', '/api/devices')).status).toBe(401);
});
it('separates receipt, contact, content change and verification timestamps; duplicate retries preserve receipt', async () => {
  const app = await setup(),
    { deviceToken, viewerToken, deviceId } = app.daniel,
    snapshot = makeFixture('mixed');
  const read = () =>
    app
      .request(viewerToken, `/api/devices/${deviceId}/snapshot`)
      .then((r) => r.json());
  const first = await app
    .request(deviceToken, uploadPath, 'PUT', snapshot)
    .then((r) => r.json());
  app.advance(10_000);
  expect(
    await app
      .request(deviceToken, uploadPath, 'PUT', snapshot)
      .then((r) => r.json()),
  ).toEqual(first);
  let view = await read();
  expect(view.lastContactAt).not.toBe(first.receivedAt);
  expect(view.lastVerifiedAt).toBe(first.receivedAt);
  app.advance(10_000);
  expect(
    (
      await app.request(deviceToken, '/api/device/heartbeat', 'POST', {
        revision: snapshot.revision,
        state: 'active',
        checkedAt: snapshot.capturedAt,
        deviceName: 'Daniel desktop',
      })
    ).status,
  ).toBe(200);
  view = await read();
  expect(view.lastVerifiedAt).toBe(view.lastContactAt);
  expect(view.receivedAt).toBe(first.receivedAt);
  expect(view.device.name).toBe('Daniel desktop');
  const verified = view.lastVerifiedAt;
  app.advance(10_000);
  await app.request(deviceToken, '/api/device/heartbeat', 'POST', {
    revision: snapshot.revision,
    state: 'paused',
    deviceName: 'Daniel desktop',
  });
  view = await read();
  expect(view.lastVerifiedAt).toBe(verified);
  expect(view.device.status).toBe('paused');
  app.advance(10_000);
  await app.request(deviceToken, uploadPath, 'PUT', {
    ...snapshot,
    revision: snapshot.revision + 1,
  });
  view = await read();
  expect(view.lastContentChangedAt).toBe(first.receivedAt);
  expect(view.receivedAt).not.toBe(first.receivedAt);
});
it('preserves prior snapshot on stale, conflicting, malformed, oversized and invalid heartbeat requests', async () => {
  const app = await setup(),
    { deviceToken, viewerToken, deviceId } = app.daniel,
    snapshot = makeFixture('mixed');
  await app.request(deviceToken, uploadPath, 'PUT', snapshot);
  for (const [value, status] of [
    [{ ...snapshot, revision: snapshot.revision - 1 }, 409],
    [{ ...snapshot, omittedTabCount: 9 }, 409],
    [{ ...snapshot, revision: snapshot.revision + 1, windows: null }, 400],
    [{ padding: 'x'.repeat(2_097_152) }, 413],
  ] as const)
    expect(
      (await app.request(deviceToken, uploadPath, 'PUT', value)).status,
    ).toBe(status);
  expect(
    (
      await app.request(deviceToken, '/api/device/heartbeat', 'POST', {
        revision: 0,
        state: 'active',
        checkedAt: snapshot.capturedAt,
        deviceName: 'Wrong',
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await app.request(deviceToken, '/api/device/heartbeat', 'POST', {
        revision: snapshot.revision,
        state: 'active',
        deviceName: 'Wrong',
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await app
        .request(viewerToken, `/api/devices/${deviceId}/snapshot`)
        .then((r) => r.json())
    ).snapshot,
  ).toEqual(snapshot);
});
it('concurrent uploads cannot roll back the accepted revision', async () => {
  const app = await setup(),
    snapshot = makeFixture('mixed'),
    { deviceToken } = app.daniel;
  const responses = await Promise.all(
    [52, 49, 51, 48, 50].map((revision) =>
      app.request(deviceToken, uploadPath, 'PUT', { ...snapshot, revision }),
    ),
  );
  expect(responses.every((r) => [200, 409].includes(r.status))).toBe(true);
  expect(
    await app.request(deviceToken, '/api/device/status').then((r) => r.json()),
  ).toEqual({ revision: 52 });
});
it('revocation retains the last snapshot, deletion removes snapshot and credentials, and state survives restart', async () => {
  const app = await setup(),
    { deviceToken, viewerToken, deviceId } = app.daniel;
  await app.request(deviceToken, uploadPath, 'PUT', makeFixture('mixed'));
  expect(
    (await app.request(viewerToken, `/api/devices/${deviceId}/revoke`, 'POST'))
      .status,
  ).toBe(200);
  expect((await app.request(deviceToken, '/api/device/status')).status).toBe(
    401,
  );
  expect(
    (
      await app
        .request(viewerToken, `/api/devices/${deviceId}/snapshot`)
        .then((r) => r.json())
    ).device.status,
  ).toBe('revoked');
  expect(
    (await app.request(viewerToken, `/api/devices/${deviceId}`, 'DELETE'))
      .status,
  ).toBe(204);
  await app.restart();
  expect(
    (await app.request(viewerToken, `/api/devices/${deviceId}/snapshot`))
      .status,
  ).toBe(404);
  expect(
    (await app.request(deviceToken, uploadPath, 'PUT', makeFixture('mixed')))
      .status,
  ).toBe(401);
  const db = new DatabaseSync(app.path);
  try {
    expect(
      db.prepare('SELECT count(*) AS n FROM devices WHERE id=?').get(deviceId),
    ).toEqual({ n: 0 });
    expect(
      db
        .prepare('SELECT count(*) AS n FROM credentials WHERE device_id=?')
        .get(deviceId),
    ).toEqual({ n: 0 });
  } finally {
    db.close();
  }
});
it('expiry and disabled owners invalidate device and viewer credentials', async () => {
  const app = await setup(),
    expiring = app.store.provision('short-lived', 'Expiring', 1000);
  app.advance(1001);
  expect(
    (await app.request(expiring.deviceToken, '/api/device/status')).status,
  ).toBe(401);
  expect((await app.request(expiring.viewerToken, '/api/devices')).status).toBe(
    401,
  );
  app.store.setOwnerActive('daniel', false);
  expect(
    (await app.request(app.daniel.deviceToken, '/api/device/status')).status,
  ).toBe(401);
  expect(
    (await app.request(app.daniel.viewerToken, '/api/devices')).status,
  ).toBe(401);
});
it('rechecks revocation after reading an in-flight upload body', async () => {
  const app = await setup(),
    { deviceToken, viewerToken, deviceId } = app.daniel;
  const raw = JSON.stringify(makeFixture('mixed'));
  let authenticated!: () => void;
  const authenticationReached = new Promise<void>((resolve) => {
    authenticated = resolve;
  });
  const originalStatus = app.store.status.bind(app.store);
  const statusSpy = vi.spyOn(app.store, 'status').mockImplementation((hash) => {
    const result = originalStatus(hash);
    authenticated();
    return result;
  });
  let finish!: () => void;
  const pending = new Promise<number>((resolve, reject) => {
    const req = httpRequest(
      `${app.base}${uploadPath}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${deviceToken}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(raw),
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode!));
      },
    );
    req.on('error', reject);
    req.write(raw.slice(0, 10));
    finish = () => req.end(raw.slice(10));
  });
  await authenticationReached;
  statusSpy.mockRestore();
  await app.request(viewerToken, `/api/devices/${deviceId}/revoke`, 'POST');
  finish();
  expect(await pending).toBe(401);
  expect(app.store.snapshot(digest(viewerToken), deviceId).snapshot).toBeNull();
});
it('rate limits with Retry-After, recovers after a minute, and never logs secrets or tab data', async () => {
  const app = await setup(2),
    { deviceToken } = app.daniel;
  await app.request(deviceToken, uploadPath, 'PUT', makeFixture('mixed'));
  await app.request(deviceToken, '/api/device/status');
  const response = await app.request(deviceToken, '/api/device/status');
  expect(response.status).toBe(429);
  expect(response.headers.get('retry-after')).toBe('60');
  app.advance(60_000);
  expect((await app.request(deviceToken, '/api/device/status')).status).toBe(
    200,
  );
  const serialized = JSON.stringify(app.logs);
  expect(serialized).not.toContain(deviceToken);
  expect(serialized).not.toContain('example');
  for (const event of app.logs)
    expect(Object.keys(event as object).sort()).toEqual([
      'durationMs',
      'operation',
      'requestId',
      'status',
    ]);
});
it('rolls back storage failures, returns safe errors, rejects foreign origins, and accepts a valid empty snapshot', async () => {
  const app = await setup(),
    { deviceToken, viewerToken, deviceId } = app.daniel,
    original = makeFixture('mixed');
  await app.request(deviceToken, uploadPath, 'PUT', original);
  const db = new DatabaseSync(app.path);
  db.exec(
    "CREATE TRIGGER fail_update BEFORE UPDATE OF snapshot ON devices BEGIN SELECT RAISE(ABORT, 'sensitive database error'); END",
  );
  const response = await app.request(deviceToken, uploadPath, 'PUT', {
    ...original,
    revision: 100,
  });
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain('sensitive');
  expect(app.store.snapshot(digest(viewerToken), deviceId).snapshot).toEqual(
    original,
  );
  db.exec('DROP TRIGGER fail_update');
  db.close();
  expect(
    (
      await app.request(deviceToken, '/api/device/status', 'GET', undefined, {
        Origin: 'https://evil.example',
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await app.request(deviceToken, uploadPath, 'PUT', {
        ...makeFixture('empty'),
        revision: 101,
      })
    ).status,
  ).toBe(200);
  expect(
    app.store.snapshot(digest(viewerToken), deviceId).snapshot?.windows,
  ).toEqual([]);
});

it('returns 413 for schema capacity limits and rejects duplicate keys and malformed UTF-8', async () => {
  const app = await setup(),
    { deviceToken } = app.daniel;
  const data = makeFixture('mixed');
  expect(
    (
      await app.request(deviceToken, uploadPath, 'PUT', {
        ...data,
        windows: Array.from({ length: 21 }, () => data.windows[0]),
      })
    ).status,
  ).toBe(413);
  for (const body of ['{"revision":1,"revision":2}', Buffer.from([0xff])]) {
    const response = await fetch(`${app.base}${uploadPath}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${deviceToken}`,
        'Content-Type': 'application/json',
      },
      body,
    });
    expect(response.status).toBe(400);
  }
});
