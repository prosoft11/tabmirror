import { expect, it } from 'vitest';
import { CloudStore } from '../apps/api/src/cloud/store';
import { MemoryBackend, MemoryObjects } from './helpers/cloud-memory';
import { DAY, YEAR, LOGIN_TTL } from '../apps/api/src/auth-contract';
import { digest } from '../apps/api/src/private-store';
import { makeFixture } from '../packages/contracts/src/fixtures';
async function setup() {
  let now = Date.parse('2026-10-02T12:00:00Z');
  const backend = new MemoryBackend(),
    objects = new MemoryObjects();
  const store = new CloudStore(backend, objects, () => now);
  await store.configureAllowlist(['a@example.test', 'b@example.test']);
  const a = await store.signIn(
    { subject: 'a', email: 'a@example.test', emailVerified: true },
    ['a@example.test'],
  );
  const b = await store.signIn(
    { subject: 'b', email: 'b@example.test', emailVerified: true },
    ['b@example.test'],
  );
  async function pair(hash = digest(a.token)) {
    const verifier = 'a'.repeat(64),
      pairing = await store.createPairing(digest(verifier), 'Synthetic Chrome');
    await store.approvePairing(hash, pairing.code, pairing.id, true);
    const result = await store.redeemPairing(pairing.id, verifier);
    if (result.status !== 'paired') throw Error('Not paired');
    return result;
  }
  const paired = await pair(),
    hash = digest(paired.token),
    viewer = digest(a.token),
    other = digest(b.token);
  return {
    store,
    backend,
    objects,
    pair,
    paired,
    hash,
    viewer,
    other,
    advance: (ms: number) => (now += ms),
  };
}
it('cloud store isolates owners/scopes and preserves atomic upload/retry/heartbeat semantics', async () => {
  const { store, hash, viewer, other, paired, advance } = await setup();
  const snapshot = makeFixture('mixed'),
    raw = JSON.stringify(snapshot);
  const ack = await store.upload(hash, raw, snapshot);
  advance(1000);
  expect(await store.upload(hash, raw, snapshot)).toEqual(ack);
  await expect(store.snapshot(other, paired.deviceId)).rejects.toMatchObject({
    status: 404,
  });
  await expect(store.snapshot(hash, paired.deviceId)).rejects.toMatchObject({
    status: 401,
  });
  await expect(store.status(viewer)).rejects.toMatchObject({ status: 401 });
  const before = await store.snapshot(viewer, paired.deviceId);
  await store.heartbeat(hash, {
    revision: snapshot.revision,
    state: 'active',
    checkedAt: new Date().toISOString(),
    deviceName: 'Renamed',
  });
  const after = await store.snapshot(viewer, paired.deviceId);
  expect(after.receivedAt).toBe(before.receivedAt);
  expect(after.lastVerifiedAt).not.toBe(before.lastVerifiedAt);
  expect(after.snapshot).toEqual(snapshot);
  expect(after.device.name).toBe('Renamed');
});
it('cloud store rejects concurrent stale writes and garbage collection preserves only the live object', async () => {
  const { store, hash, viewer, paired, objects, advance } = await setup();
  const first = makeFixture('mixed'),
    second = { ...first, revision: first.revision + 1 };
  await Promise.allSettled(
    [first, second].map((value) =>
      store.upload(hash, JSON.stringify(value), value),
    ),
  );
  expect(
    (await store.snapshot(viewer, paired.deviceId)).snapshot?.revision,
  ).toBe(second.revision);
  advance(LOGIN_TTL * 2);
  await store.cleanup();
  expect(objects.values.size).toBe(1);
  await store.delete(viewer, paired.deviceId);
  await store.cleanup();
  expect(objects.values.size).toBe(0);
  await expect(store.status(hash)).rejects.toMatchObject({ status: 401 });
});
it('revocation during S3 publication or retrieval cannot authorize a late write/read', async () => {
  const x = await setup(),
    snapshot = makeFixture('mixed');
  x.objects.afterPut = async () => {
    x.objects.afterPut = undefined;
    await x.store.revoke(x.viewer, x.paired.deviceId);
  };
  await expect(
    x.store.upload(x.hash, JSON.stringify(snapshot), snapshot),
  ).rejects.toMatchObject({ status: 401 });
  expect(
    (await x.store.snapshot(x.viewer, x.paired.deviceId)).snapshot,
  ).toBeNull();
  x.advance(LOGIN_TTL * 2);
  await x.store.cleanup();
  expect(x.objects.values.size).toBe(0);
  const y = await setup();
  await y.store.upload(y.hash, JSON.stringify(snapshot), snapshot);
  y.objects.afterGet = async () => {
    y.objects.afterGet = undefined;
    await y.store.logout(y.viewer);
  };
  await expect(
    y.store.snapshot(y.viewer, y.paired.deviceId),
  ).rejects.toMatchObject({ status: 401 });
});
it('cloud pairing reservations, expiry, failed verifier commits and replay fail closed', async () => {
  const { store, viewer, other, advance } = await setup();
  const verifier = 'b'.repeat(64),
    p = await store.createPairing(digest(verifier), 'Other');
  await expect(
    store.approvePairing(viewer, p.code, p.id, true),
  ).rejects.toMatchObject({ status: 409 });
  await store.approvePairing(other, p.code, p.id, true);
  const next = await store.createPairing(digest(verifier), 'Concurrent');
  await expect(
    store.approvePairing(other, next.code, next.id, true),
  ).rejects.toMatchObject({ status: 409 });
  for (let n = 0; n < 5; n++) {
    await expect(store.redeemPairing(p.id, 'wrong')).rejects.toMatchObject({
      status: 401,
    });
    advance(5000);
  }
  await expect(store.redeemPairing(p.id, verifier)).rejects.toMatchObject({
    status: 410,
  });
  advance(LOGIN_TTL);
  await expect(store.lookupPairing(other, next.code)).rejects.toMatchObject({
    status: 410,
  });
});
it('cloud sessions renew once daily, logout/allowlist removal persist, and grants/rate limits are single use', async () => {
  const { store, viewer, other, advance } = await setup();
  expect((await store.session(viewer)).renewed).toBe(false);
  advance(DAY);
  expect((await store.session(viewer)).renewed).toBe(true);
  await store.beginLogin('grant');
  await store.consumeLogin('grant');
  await expect(store.consumeLogin('grant')).rejects.toMatchObject({
    status: 401,
  });
  await store.throttle('test', 1, 1000);
  await expect(store.throttle('test', 1, 1000)).rejects.toMatchObject({
    status: 429,
  });
  advance(1001);
  await store.throttle('test', 1, 1000);
  await store.configureAllowlist(['b@example.test']);
  await expect(store.session(viewer)).rejects.toMatchObject({ status: 401 });
  await store.configureAllowlist(['a@example.test', 'b@example.test']);
  await expect(store.session(viewer)).rejects.toMatchObject({ status: 401 });
  advance(YEAR);
  await expect(store.session(other)).rejects.toMatchObject({ status: 401 });
});
it('cleanup wins publication race safely and never deletes a live pointer', async () => {
  const { store, hash, objects, advance } = await setup(),
    snapshot = makeFixture('mixed');
  objects.afterPut = async () => {
    advance(LOGIN_TTL * 2);
    await store.cleanup();
  };
  await expect(
    store.upload(hash, JSON.stringify(snapshot), snapshot),
  ).rejects.toMatchObject({ status: 503 });
  expect(objects.values.size).toBe(0);
});

it('does not return a snapshot when the session expires during object retrieval', async () => {
  const { store, hash, viewer, paired, objects, advance } = await setup();
  const snapshot = makeFixture('mixed');
  await store.upload(hash, JSON.stringify(snapshot), snapshot);
  objects.afterGet = async () => {
    advance(YEAR + 1);
  };
  await expect(store.snapshot(viewer, paired.deviceId)).rejects.toMatchObject({
    status: 401,
  });
});
