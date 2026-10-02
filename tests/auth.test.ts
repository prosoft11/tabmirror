import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  SqliteAuthStore,
  DAY,
  YEAR,
  LOGIN_TTL,
} from '../apps/api/src/auth-store';
import { createPrivateApi } from '../apps/api/src/private-api';
import { WebAuth, csrfToken } from '../apps/api/src/web-auth';
import { digest } from '../apps/api/src/private-store';
import { makeFixture } from '../packages/contracts/src/fixtures';
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
const allow = ['daniel@example.test', 'farris@example.test'];
function setupStore() {
  const dir = mkdtempSync(join(tmpdir(), 'tabmirror-auth-'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  let now = Date.parse('2026-09-23T00:00:00Z');
  const store = new SqliteAuthStore(join(dir, 'auth.sqlite'), () => now);
  cleanup.push(() => store.close());
  const login = (subject = 'daniel', email = allow[0]!) =>
    store.signIn({ subject, email, emailVerified: true }, allow);
  return {
    store,
    login,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
it('enrolls only verified allowed emails; immutable subjects prevent email takeover', () => {
  const { store, login } = setupStore();
  const session = login();
  expect(store.session(digest(session.token)).email).toBe(allow[0]);
  expect(() => login('evil', 'evil@example.test')).toThrow('not approved');
  expect(() =>
    store.signIn(
      { subject: 'bad', email: allow[1]!, emailVerified: false },
      allow,
    ),
  ).toThrow('not approved');
  expect(() => login('different-subject', allow[0]!)).toThrow(
    'administrator review',
  );
  store.configureAllowlist([allow[1]!]);
  expect(() => store.session(digest(session.token))).toThrow();
  expect(() => login()).toThrow('disabled');
});
it('renews at most daily with a stable token, expires after inactivity, and rotates at reauthentication', () => {
  const { store, login, advance } = setupStore();
  const first = login(),
    hash = digest(first.token);
  expect(store.session(hash).renewed).toBe(false);
  advance(DAY);
  const renewed = store.session(hash);
  expect(renewed.renewed).toBe(true);
  expect(renewed.expiresAt).toBe(first.expiresAt + DAY);
  expect(store.session(hash).renewed).toBe(false);
  const rotated = store.signIn(
    { subject: 'daniel', email: allow[0]!, emailVerified: true },
    allow,
    hash,
  );
  expect(rotated.token).not.toBe(first.token);
  expect(() => store.session(hash)).toThrow();
  advance(YEAR);
  expect(() => store.session(digest(rotated.token))).toThrow();
});
it('login transactions are browser bound, single-use and expire', () => {
  const { store, advance } = setupStore();
  store.beginLogin('a');
  expect(() => store.consumeLogin('b')).toThrow();
  store.consumeLogin('a');
  expect(() => store.consumeLogin('a')).toThrow();
  store.beginLogin('c');
  advance(LOGIN_TTL);
  expect(() => store.consumeLogin('c')).toThrow();
});
it('pairing binds verifier and approving owner, cannot replay, and requires explicit device replacement', () => {
  const { store, login, advance } = setupStore();
  const first = login(),
    second = login('farris', allow[1]);
  const verifier = 'a'.repeat(64);
  const pair = store.createPairing(digest(verifier), 'My desktop');
  expect(pair.code).toHaveLength(8);
  expect(store.redeemPairing(pair.id, verifier)).toEqual({ status: 'pending' });
  store.approvePairing(digest(first.token), pair.code, pair.id, true);
  advance(5000);
  const result = store.redeemPairing(pair.id, verifier);
  if (result.status !== 'paired') throw Error('not paired');
  expect(store.devices(digest(first.token))[0]?.id).toBe(result.deviceId);
  expect(store.devices(digest(second.token))).toEqual([]);
  expect(() => store.snapshot(digest(second.token), result.deviceId)).toThrow(
    'not found',
  );
  expect(() => store.redeemPairing(pair.id, verifier)).toThrow('already used');
  const replacement = store.createPairing(digest(verifier), 'Replacement');
  expect(() =>
    store.approvePairing(
      digest(first.token),
      replacement.code,
      replacement.id,
      true,
    ),
  ).toThrow('Revoke');
  store.revoke(digest(first.token), result.deviceId);
  store.approvePairing(
    digest(first.token),
    replacement.code,
    replacement.id,
    true,
  );
  expect(store.redeemPairing(replacement.id, verifier).status).toBe('paired');
  expect(() => store.status(digest(result.token))).toThrow();
});
it('approved pairing reservations block concurrent approvals and another owner cannot overwrite approval', () => {
  const { store, login } = setupStore();
  const daniel = login(),
    farris = login('farris', allow[1]);
  const a = store.createPairing('a'.repeat(64), 'A'),
    b = store.createPairing('b'.repeat(64), 'B');
  store.approvePairing(digest(daniel.token), a.code, a.id, true);
  expect(() =>
    store.approvePairing(digest(daniel.token), b.code, b.id, true),
  ).toThrow('Revoke');
  expect(() =>
    store.approvePairing(digest(farris.token), a.code, a.id, true),
  ).toThrow('already used');
});
it('wrong verifier attempts terminate pairing; denial, expiry and owner disablement fail closed', () => {
  const { store, login, advance } = setupStore();
  const session = login();
  const hash = digest(session.token),
    verifier = 'a'.repeat(64);
  const pair = store.createPairing(digest(verifier), 'A');
  for (let n = 0; n < 5; n++) {
    expect(() => store.redeemPairing(pair.id, 'b'.repeat(64))).toThrow(
      'invalid',
    );
    advance(5000);
  }
  expect(() => store.redeemPairing(pair.id, verifier)).toThrow('already used');
  const denied = store.createPairing(digest(verifier), 'A');
  store.approvePairing(hash, denied.code, denied.id, false);
  expect(() => store.redeemPairing(denied.id, verifier)).toThrow(
    'already used',
  );
  const expired = store.createPairing(digest(verifier), 'A');
  advance(LOGIN_TTL);
  expect(() => store.lookupPairing(hash, expired.code)).toThrow();
  const disabled = store.createPairing(digest(verifier), 'A');
  store.approvePairing(hash, disabled.code, disabled.id, true);
  store.configureAllowlist([]);
  expect(() => store.redeemPairing(disabled.id, verifier)).toThrow();
});
it('device credentials renew on activity but expire after a year of inactivity', () => {
  const { store, login, advance } = setupStore();
  const hash = digest(login().token),
    verifier = 'a'.repeat(64);
  const pair = store.createPairing(digest(verifier), 'A');
  store.approvePairing(hash, pair.code, pair.id, true);
  const result = store.redeemPairing(pair.id, verifier);
  if (result.status !== 'paired') throw Error('pair');
  advance(DAY);
  expect(store.status(digest(result.token))).toEqual({ revision: 0 });
  advance(YEAR);
  expect(() => store.status(digest(result.token))).toThrow();
});
it('limits pairing polling and durable brute-force buckets', () => {
  const { store, advance } = setupStore();
  const verifier = 'a'.repeat(64),
    pair = store.createPairing(digest(verifier), 'A');
  store.redeemPairing(pair.id, verifier);
  expect(() => store.redeemPairing(pair.id, verifier)).toThrow('five seconds');
  store.throttle('test', 1, 60_000);
  expect(() => store.throttle('test', 1, 60_000)).toThrow('Too many');
  advance(60_000);
  store.throttle('test', 1, 60_000);
});
async function httpSetup(secure = false) {
  const app = setupStore(),
    origin = secure ? 'https://tabmirror.example' : 'http://127.0.0.1:4317';
  const options = {
    allowedHosts: [] as string[],
    viewerOrigin: origin,
    extensionOrigin: /^chrome-extension:\/\/[a-p]{32}$/,
    auth: new WebAuth(app.store, {
      origin,
      local: !secure,
      allowedEmails: allow,
      provider: async () => ({
        authorizationUrl: async () => 'https://accounts.google.com/test',
        exchange: async () => ({
          subject: 'daniel',
          email: allow[0]!,
          emailVerified: true,
        }),
      }),
    }),
  };
  const server = createPrivateApi(app.store, options);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  cleanup.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('port');
  options.allowedHosts = [`127.0.0.1:${address.port}`];
  const base = `http://${options.allowedHosts[0]}`;
  const token = app.login().token,
    cookieName = secure
      ? '__Host-tabmirror_session'
      : 'tabmirror_local_session';
  const request = (
    path: string,
    method = 'GET',
    value?: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(base + path, {
      method,
      redirect: 'manual',
      headers: {
        Cookie: `${cookieName}=${token}`,
        Origin: origin,
        'X-CSRF-Token': csrfToken(token),
        'Content-Type': 'application/json',
        ...headers,
      },
      body: value === undefined ? undefined : JSON.stringify(value),
    });
  return { ...app, request, token, origin, base };
}
it('cookie viewer routes enforce CSRF, reject bearer bypass and support logout', async () => {
  const app = await httpSetup();
  expect(
    (await app.request('/api/session').then((r) => r.json())).authenticated,
  ).toBe(true);
  expect(
    (
      await app.request(
        '/api/pairings/lookup',
        'POST',
        { code: 'ABCDEFGH' },
        { 'X-CSRF-Token': '' },
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await app.request('/api/auth/logout', 'POST', undefined, {
        Origin: 'https://evil.example',
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await app.request('/api/devices', 'GET', undefined, {
        Cookie: '',
        Authorization: `Bearer ${app.token}`,
      })
    ).status,
  ).toBe(401);
  expect(
    (await app.request('/api/auth/logout', 'POST')).headers.get('set-cookie'),
  ).toContain('Max-Age=0');
  expect((await app.request('/api/devices')).status).toBe(401);
});
it('HTTPS session cookies are Secure/HttpOnly/SameSite and concurrent renewal keeps the same token', async () => {
  const app = await httpSetup(true);
  app.advance(DAY);
  const responses = await Promise.all([
    app.request('/api/session'),
    app.request('/api/session'),
  ]);
  const cookies = responses
    .map((r) => r.headers.get('set-cookie'))
    .filter(Boolean);
  expect(cookies).toHaveLength(1);
  expect(cookies[0]).toContain(`__Host-tabmirror_session=${app.token}`);
  expect(cookies[0]).toContain(
    'HttpOnly; SameSite=Lax; Max-Age=31536000; Secure',
  );
  expect(cookies[0]).not.toContain('Domain');
});
it('HTTP pairing completes under session owner and produces upload-only token', async () => {
  const app = await httpSetup(),
    verifier = 'a'.repeat(64);
  const extensionHeaders = {
    Cookie: '',
    Origin: `chrome-extension://${'a'.repeat(32)}`,
  };
  const pair = await app
    .request(
      '/api/pairings/start',
      'POST',
      { challenge: digest(verifier), name: 'Synthetic desktop' },
      extensionHeaders,
    )
    .then((r) => r.json());
  expect(
    (await app.request('/api/pairings/lookup', 'POST', { code: pair.code }))
      .status,
  ).toBe(200);
  expect(
    (
      await app.request('/api/pairings/approve', 'POST', {
        code: pair.code,
        id: pair.id,
      })
    ).status,
  ).toBe(200);
  const paired = await app
    .request(
      '/api/pairings/redeem',
      'POST',
      { id: pair.id, verifier },
      extensionHeaders,
    )
    .then((r) => r.json());
  const headers = {
    ...extensionHeaders,
    Authorization: `Bearer ${paired.token}`,
  };
  expect(
    (
      await app.request(
        '/api/device/snapshot',
        'PUT',
        makeFixture('mixed'),
        headers,
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await app
        .request(`/api/devices/${paired.deviceId}/snapshot`)
        .then((r) => r.json())
    ).snapshot,
  ).toEqual(makeFixture('mixed'));
  expect(
    (
      await app.request('/api/devices', 'GET', undefined, {
        Cookie: '',
        Authorization: `Bearer ${paired.token}`,
      })
    ).status,
  ).toBe(401);
  expect(
    (
      await app.request(
        '/api/pairings/redeem',
        'POST',
        { id: pair.id, verifier },
        extensionHeaders,
      )
    ).status,
  ).toBe(410);
});
it('OAuth callback consumes only its initiating browser transaction and rotates prior session', async () => {
  const app = await httpSetup();
  const begin = await app.request('/api/auth/login', 'POST');
  const loginCookie = begin.headers.get('set-cookie')!.split(';')[0]!;
  expect(
    (await app.request('/api/auth/callback?code=test')).headers.get('location'),
  ).toBe('/?auth=failed');
  const callback = await app.request(
    '/api/auth/callback?code=test',
    'GET',
    undefined,
    { Cookie: `${loginCookie}; tabmirror_local_session=${app.token}` },
  );
  expect(callback.headers.get('location')).toBe('/pair');
  expect(() => app.store.session(digest(app.token))).toThrow();
  expect(
    (
      await app.request('/api/auth/callback?code=test', 'GET', undefined, {
        Cookie: loginCookie,
      })
    ).headers.get('location'),
  ).toBe('/?auth=failed');
});

it('sessions, approved pairings, consumed grants and attempt limits persist across database restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tabmirror-auth-restart-'));
  const file = join(dir, 'db.sqlite');
  let store = new SqliteAuthStore(file);
  try {
    const session = store.signIn(
        { subject: 'daniel', email: allow[0]!, emailVerified: true },
        allow,
      ),
      hash = digest(session.token),
      verifier = 'a'.repeat(64);
    const pair = store.createPairing(digest(verifier), 'Durable device');
    store.approvePairing(hash, pair.code, pair.id, true);
    store.throttle('persistent', 1, 60_000);
    store.close();
    store = new SqliteAuthStore(file);
    expect(store.session(hash).email).toBe(allow[0]);
    expect(() => store.throttle('persistent', 1, 60_000)).toThrow('Too many');
    expect(store.redeemPairing(pair.id, verifier).status).toBe('paired');
    store.close();
    store = new SqliteAuthStore(file);
    expect(() => store.redeemPairing(pair.id, verifier)).toThrow(
      'already used',
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
