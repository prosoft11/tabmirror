import https from 'node:https';
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
const edge = process.argv[2];
if (!edge || !/^[a-z0-9]+\.cloudfront\.net$/.test(edge))
  throw Error('Supply the deployed CloudFront hostname');
const origin = 'https://tabs.portuit.com';
function request(path, method = 'GET', headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: edge,
        servername: 'tabs.portuit.com',
        path,
        method,
        headers: { Host: 'tabs.portuit.com', ...headers },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('error', reject);
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    req.setTimeout(25000, () => req.destroy(Error('Timeout')));
    req.end();
  });
}
const page = await request('/');
assert.equal(page.status, 200, 'Website entry');
assert.ok(page.body.includes('<div id="root">'));
assert.ok(page.headers['strict-transport-security']);
assert.ok(page.headers['content-security-policy']);
assert.equal((await request('/pair')).status, 200);
const session = await request('/api/session');
assert.equal(session.status, 200, 'Session endpoint');
assert.equal(session.headers['cache-control'], 'no-store');
assert.equal(JSON.parse(session.body).authenticated, false);
assert.equal(JSON.parse(session.body).googleConfigured, true);
assert.equal((await request('/api/devices')).status, 401);
assert.equal(
  (
    await request('/api/devices', 'GET', {
      Cookie: '__Host-tabmirror_session=' + 'a'.repeat(64),
    })
  ).status,
  401,
);
assert.equal(
  (
    await request('/api/session', 'GET', {
      Origin: 'https://untrusted.example',
    })
  ).status,
  403,
);
const health = await request('/api/health');
assert.equal(health.status, 200);
assert.equal(JSON.parse(health.body).ok, true);
const login = await request('/api/auth/login', 'POST', { Origin: origin });
assert.equal(login.status, 200, 'Google discovery and login initiation');
const url = new URL(JSON.parse(login.body).authorizationUrl);
assert.equal(url.hostname, 'accounts.google.com');
assert.equal(
  url.searchParams.get('redirect_uri'),
  origin + '/api/auth/callback',
);
assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
const cookies = login.headers['set-cookie'] ?? [];
assert.ok(
  cookies.some(
    (c) =>
      c.includes('Secure') &&
      c.includes('HttpOnly') &&
      c.includes('SameSite=Lax'),
  ),
);
const results = {
  checkedAt: new Date().toISOString(),
  origin,
  edge,
  tlsVerified: true,
  website: true,
  pairRoute: true,
  unauthenticatedBlocked: true,
  forgedSessionBlocked: true,
  crossOriginBlocked: true,
  noStore: true,
  databaseHealth: true,
  googleDiscoveryAndPkceInitiation: true,
  secureLoginCookie: true,
  fullGoogleSignIn: false,
  dnsMethod:
    'Connect to CloudFront with canonical Host and validated TLS SNI; does not require the final tabs CNAME.',
};
await mkdir('artifacts/hosting', { recursive: true });
await writeFile(
  'artifacts/hosting/smoke.json',
  JSON.stringify(results, null, 2) + '\n',
);
console.log(JSON.stringify(results, null, 2));
