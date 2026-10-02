import { it, expect, afterEach } from 'vitest';
import { createCollector } from '../apps/api/src/collector';
import { makeFixture } from '../packages/contracts/src/fixtures';
import type { Server } from 'node:http';
const token = 'a'.repeat(64);
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0))
    await new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
});
async function setup() {
  const server = createCollector(token);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('port');
  return (
    path: string,
    method = 'GET',
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
}
it('collector authenticates, replaces snapshots atomically, rejects stale/invalid writes and revokes', async () => {
  const request = await setup();
  const path = '/api/device/snapshot';
  const data = makeFixture('mixed');
  expect(
    (
      await request('/api/device/status', 'GET', undefined, {
        Authorization: 'Bearer wrong',
      })
    ).status,
  ).toBe(401);
  expect(
    (
      await request('/api/device/status', 'GET', undefined, {
        Origin: 'https://evil.example',
      })
    ).status,
  ).toBe(403);
  const initial = await request(path, 'PUT', data);
  expect(initial.status).toBe(200);
  const ack = await initial.json();
  expect(await request(path, 'PUT', data).then((r) => r.json())).toEqual(ack);
  expect(
    (await request(path, 'PUT', { ...data, omittedTabCount: 9 })).status,
  ).toBe(409);
  expect((await request(path, 'PUT', { ...data, revision: 41 })).status).toBe(
    409,
  );
  expect(
    (await request(path, 'PUT', { ...data, revision: 43, ownerId: 'forged' }))
      .status,
  ).toBe(400);
  expect(
    (await request('/api/devices/local/snapshot').then((r) => r.json()))
      .snapshot,
  ).toEqual(data);
  expect(
    (
      await request('/api/device/heartbeat', 'POST', {
        revision: 1,
        state: 'active',
        checkedAt: data.capturedAt,
        deviceName: 'Mac',
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await request('/api/device/heartbeat', 'POST', {
        revision: 42,
        state: 'active',
        checkedAt: data.capturedAt,
        deviceName: 'Mac',
      })
    ).status,
  ).toBe(200);
  expect(
    (await request(path, 'PUT', { ...makeFixture('empty'), revision: 43 }))
      .status,
  ).toBe(200);
  expect(
    (await request('/api/devices/local/snapshot').then((r) => r.json()))
      .snapshot.windows,
  ).toEqual([]);
  expect((await request('/api/device/disconnect', 'POST')).status).toBe(200);
  expect((await request(path, 'PUT', { ...data, revision: 44 })).status).toBe(
    401,
  );
});
