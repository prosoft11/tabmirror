import { afterEach, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { httpAdapter } from '../apps/api/src/cloud/http-adapter';
import { createPrivateApi } from '../apps/api/src/private-api';
import { WebAuth, csrfToken } from '../apps/api/src/web-auth';
import { CloudStore } from '../apps/api/src/cloud/store';
import { MemoryBackend, MemoryObjects } from './helpers/cloud-memory';
import { DAY } from '../apps/api/src/auth-contract';
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
function event(
  path: string,
  method = 'GET',
  headers: Record<string, string> = {},
  body?: string,
): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    rawPath: path,
    rawQueryString: '',
    headers,
    requestContext: { http: { method, sourceIp: '203.0.113.1' } },
    body,
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}
it('production bridge preserves Secure renewal cookies and async authentication/CSRF behavior', async () => {
  let now = Date.now();
  const store = new CloudStore(
    new MemoryBackend(),
    new MemoryObjects(),
    () => now,
  );
  await store.configureAllowlist(['a@example.test']);
  const signed = await store.signIn(
    { subject: 'a', email: 'a@example.test', emailVerified: true },
    ['a@example.test'],
  );
  now += DAY;
  const origin = 'https://tabs.portuit.com',
    server = createPrivateApi(store, {
      allowedHosts: ['tabs.portuit.com'],
      viewerOrigin: origin,
      extensionOrigin: /^chrome-extension:\/\/a{32}$/,
      auth: new WebAuth(store, {
        origin,
        local: false,
        allowedEmails: ['a@example.test'],
      }),
    });
  servers.push(server);
  const serve = httpAdapter(server, 'tabs.portuit.com'),
    req = event('/api/session');
  req.cookies = [`__Host-tabmirror_session=${signed.token}`];
  const response = await serve(req);
  expect(response.statusCode).toBe(200);
  expect(JSON.parse(response.body!).authenticated).toBe(true);
  expect(response.cookies?.[0]).toContain('Secure');
  expect(response.cookies?.[0]).toContain('HttpOnly');
  expect(response.headers?.['cache-control']).toBe('no-store');
  const bad = event('/api/auth/logout', 'POST', {
    origin,
    'x-csrf-token': 'bad',
  });
  bad.cookies = req.cookies;
  expect((await serve(bad)).statusCode).toBe(403);
  bad.headers['x-csrf-token'] = csrfToken(signed.token);
  expect((await serve(bad)).statusCode).toBe(200);
  expect(JSON.parse((await serve(req)).body!).authenticated).toBe(false);
});
it('production bridge rejects oversized/base64-malformed bodies before routing', async () => {
  const store = new CloudStore(new MemoryBackend(), new MemoryObjects());
  const server = createPrivateApi(store, {
    allowedHosts: ['tabs.portuit.com'],
    viewerOrigin: 'https://tabs.portuit.com',
    extensionOrigin: /^never$/,
  });
  servers.push(server);
  const serve = httpAdapter(server, 'tabs.portuit.com');
  const req = event('/api/device/snapshot', 'PUT', {}, '%%%');
  req.isBase64Encoded = true;
  const rejected = await serve(req);
  expect(rejected.statusCode).toBe(413);
  expect(rejected.headers?.['cache-control']).toBe('no-store');
  expect(
    (
      await serve(
        event(
          '/api/device/snapshot',
          'PUT',
          {},
          'x'.repeat(2 * 1024 * 1024 + 1),
        ),
      )
    ).statusCode,
  ).toBe(413);
  expect((await serve(event('/api/\r\nInjected'))).statusCode).toBe(400);
});
