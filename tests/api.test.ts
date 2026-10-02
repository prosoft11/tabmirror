import { afterEach, describe, expect, it } from 'vitest';
import { createLocalApp } from '../apps/api/src/app';
import { readConfig } from '../apps/api/src/config';
import { MemorySnapshotStore } from '../apps/api/src/store';
import { makeFixture } from '../packages/contracts/src/fixtures';
import { request as httpRequest, type Server } from 'node:http';
const environment = {
  NODE_ENV: 'development',
  APP_MODE: 'local',
  AUTH_MODE: 'mock',
  STORAGE_DRIVER: 'memory',
  API_HOST: '127.0.0.1',
  API_PORT: '4318',
  WEB_PORT: '4317',
};
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((resolve) => {
          s.closeAllConnections();
          s.close(() => resolve());
        }),
    ),
  );
});
async function app() {
  const { server } = createLocalApp(environment);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No port');
  const base = `http://127.0.0.1:${address.port}`;
  return (path: string, options: RequestInit = {}) =>
    new Promise<Response>((resolve, reject) => {
      const req = httpRequest(
        base + path,
        {
          method: options.method || 'GET',
          headers: {
            Host: '127.0.0.1:4318',
            ...(options.headers as Record<string, string>),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () =>
            resolve(
              new Response(Buffer.concat(chunks).toString(), {
                status: res.statusCode!,
                headers: res.headers as Record<string, string>,
              }),
            ),
          );
        },
      );
      req.on('error', reject);
      req.end(options.body);
    });
}
describe('local API boundary', () => {
  it.each([
    { NODE_ENV: 'production' },
    { NODE_ENV: undefined },
    { APP_MODE: 'production' },
    { AUTH_MODE: 'google' },
    { AUTH_MODE: undefined },
    { STORAGE_DRIVER: 's3' },
    { API_HOST: '0.0.0.0' },
    { API_PORT: '0' },
    { API_PORT: '4317' },
  ])('fails closed with %j', (change) => {
    expect(() => readConfig({ ...environment, ...change })).toThrow();
  });
  it('serves validated fixtures through the read-only API', async () => {
    const request = await app();
    const health = await request('/api/health');
    expect(health.status).toBe(200);
    for (const name of ['mixed', 'empty', 'large'] as const) {
      const response = await request(`/api/devices/${name}/snapshot`);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.status).toBe(200);
      expect((await response.json()).snapshot).toEqual(makeFixture(name));
    }
    expect(
      (await request('/api/session').then((r) => r.json())).authenticated,
    ).toBe(false);
    expect(
      (await request('/api/device/snapshot', { method: 'PUT', body: '{}' }))
        .status,
    ).toBe(405);
    expect((await request('/api/devices/other/snapshot')).status).toBe(404);
  });
  it('rejects remote hosts and cross-origin browser calls', async () => {
    const request = await app();
    expect(
      (await request('/api/health', { headers: { Host: 'evil.example' } }))
        .status,
    ).toBe(403);
    expect(
      (
        await request('/api/health', {
          headers: { Origin: 'https://evil.example' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request('/api/health', {
          headers: { 'Sec-Fetch-Site': 'cross-site' },
        })
      ).status,
    ).toBe(403);
  });
  it('isolates owners and does not expose mutable references', async () => {
    const store = new MemorySnapshotStore();
    const item = {
      device: { id: 'mixed', name: 'Test', status: 'active' as const },
      receivedAt: null,
      lastContactAt: null,
      lastVerifiedAt: null,
      snapshot: makeFixture('mixed'),
    };
    await store.replace('alice', item);
    item.device.name = 'Mutated';
    expect(await store.get('bob', 'mixed')).toBeNull();
    const saved = await store.get('alice', 'mixed');
    expect(saved?.device.name).toBe('Test');
    saved!.snapshot.windows = [];
    expect((await store.get('alice', 'mixed'))!.snapshot.windows.length).toBe(
      2,
    );
  });
});
