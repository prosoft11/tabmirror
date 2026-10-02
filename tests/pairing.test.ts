import { expect, it } from 'vitest';
import {
  PairingEngine,
  type PairingState,
} from '../apps/extension/src/pairing';
const id = '11111111-1111-4111-8111-111111111111';
function setup() {
  let now = 100_000,
    state: PairingState | undefined,
    requests = 0,
    redeemed = false,
    connected = 0,
    failConnect = false,
    loseResponse = false;
  const ports = {
    load: async () => structuredClone(state),
    save: async (value: PairingState | undefined) => {
      state = structuredClone(value);
    },
    now: () => now,
    connect: async () => {
      connected++;
      if (failConnect) throw Error('offline');
    },
    fetch: (async (url: string | URL | Request) => {
      requests++;
      if (String(url).endsWith('/start'))
        return Response.json({
          id,
          code: 'ABCDEFGH',
          expiresAt: now + 600_000,
        });
      if (redeemed)
        return Response.json({ error: 'consumed' }, { status: 410 });
      redeemed = true;
      if (loseResponse) throw Error('response lost');
      return Response.json({ status: 'paired', token: 'b'.repeat(64) });
    }) as typeof fetch,
  };
  return {
    engine: () => new PairingEngine(ports),
    advance: (ms: number) => {
      now += ms;
    },
    stats: () => ({ state, requests, connected }),
    failConnect: () => {
      failConnect = true;
    },
    recover: () => {
      failConnect = false;
    },
    loseResponse: () => {
      loseResponse = true;
    },
  };
}
it('persists pairing secret, hides it from popup state, throttles polls and removes secret after enrollment', async () => {
  const app = setup(),
    engine = app.engine();
  await engine.start('My Mac');
  expect(app.stats().state?.verifier).toHaveLength(64);
  expect(await engine.view()).not.toHaveProperty('verifier');
  await engine.poll();
  expect(app.stats().requests).toBe(1);
  app.advance(5000);
  await app.engine().poll();
  expect(app.stats().connected).toBe(1);
  expect(app.stats().state).toBeUndefined();
});
it('retains newly issued credentials across worker restart if connecting fails, without redeeming twice', async () => {
  const app = setup();
  await app.engine().start('My Mac');
  app.advance(5000);
  app.failConnect();
  await app.engine().poll();
  expect(app.stats().state?.token).toBe('b'.repeat(64));
  expect(app.stats().state?.verifier).toBe('');
  expect(await app.engine().view()).not.toHaveProperty('token');
  app.recover();
  app.advance(15_000);
  await app.engine().poll();
  expect(app.stats().requests).toBe(2);
  expect(app.stats().state).toBeUndefined();
});
it('lost redemption response fails closed and asks for a new pairing rather than replaying a grant', async () => {
  const app = setup();
  await app.engine().start('My Mac');
  app.advance(5000);
  app.loseResponse();
  await app.engine().poll();
  app.advance(15_000);
  await app.engine().poll();
  expect(app.stats().state?.verifier).toBe('');
  expect(app.stats().state?.error).toContain('already used');
  const requests = app.stats().requests;
  app.advance(30_000);
  await app.engine().poll();
  expect(app.stats().requests).toBe(requests);
});
it('expired and cancelled pairing states remove installation secrets', async () => {
  const app = setup();
  await app.engine().start('My Mac');
  app.advance(600_000);
  await app.engine().poll();
  expect(app.stats().state).toBeUndefined();
  await app.engine().start('My Mac');
  await app.engine().cancel();
  expect(app.stats().state).toBeUndefined();
});
