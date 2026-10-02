// Synthetic signed OIDC provider exists only in this verification script, never the application bootstrap.
import { chromium, type BrowserContext, type Browser } from 'playwright';
import { createServer, request as proxyRequest } from 'node:http';
import {
  generateKeyPairSync,
  randomBytes,
  sign,
  createHash,
} from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, cp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
import * as oidc from 'openid-client';
import { SqliteAuthStore } from '../apps/api/src/auth-store';
import { createPrivateApi } from '../apps/api/src/private-api';
import { WebAuth } from '../apps/api/src/web-auth';
import { GoogleOidc } from '../apps/api/src/google-oidc';
const origin = 'http://127.0.0.1:4337',
  issuer = 'https://accounts.google.com',
  clientId = 'synthetic-client';
const directory = await mkdtemp(join(tmpdir(), 'tabmirror-auth-browser-'));
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const grants = new Map<string, { nonce: string; challenge: string }>();
const configuration = new oidc.Configuration(
  {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/jwks`,
  },
  clientId,
  { client_secret: 'test-only', id_token_signed_response_alg: 'RS256' },
);
configuration[oidc.customFetch] = async (url, init) => {
  if (String(url).endsWith('/jwks'))
    return Response.json({
      keys: [
        {
          ...keys.publicKey.export({ format: 'jwk' }),
          kid: 'test',
          alg: 'RS256',
          use: 'sig',
        },
      ],
    });
  const body = new URLSearchParams(String(init?.body));
  const code = body.get('code')!;
  const grant = grants.get(code);
  grants.delete(code);
  assert.ok(grant, 'valid single-use authorization grant');
  assert.equal(
    createHash('sha256').update(body.get('code_verifier')!).digest('base64url'),
    grant.challenge,
    'PKCE verified',
  );
  const now = Math.floor(Date.now() / 1000);
  const content = [
    { alg: 'RS256', kid: 'test' },
    {
      iss: issuer,
      aud: clientId,
      sub: 'synthetic-google-subject',
      iat: now,
      exp: now + 300,
      nonce: grant.nonce,
      email: 'daniel@example.test',
      email_verified: true,
    },
  ]
    .map((v) => Buffer.from(JSON.stringify(v)).toString('base64url'))
    .join('.');
  const jwt = `${content}.${sign('RSA-SHA256', Buffer.from(content), keys.privateKey).toString('base64url')}`;
  return Response.json({
    access_token: 'synthetic',
    token_type: 'Bearer',
    id_token: jwt,
  });
};
const provider = new GoogleOidc(configuration, `${origin}/api/auth/callback`);
const store = new SqliteAuthStore(join(directory, 'private.sqlite'));
const auth = new WebAuth(store, {
  origin,
  local: true,
  allowedEmails: ['daniel@example.test'],
  provider: async () => provider,
});
const api = createPrivateApi(store, {
  allowedHosts: ['127.0.0.1:4341', '127.0.0.1:4337'],
  viewerOrigin: origin,
  extensionOrigin: /^chrome-extension:\/\/[a-p]{32}$/,
  auth,
  rateLimit: 600,
  log: (event) => {
    if (event.status >= 400)
      console.log(`API test: ${event.operation} ${event.status}`);
  },
});
const web = createServer(async (req, res) => {
  if (req.url?.startsWith('/api/')) {
    const upstream = proxyRequest(
      {
        hostname: '127.0.0.1',
        port: 4341,
        path: req.url,
        method: req.method,
        headers: req.headers,
      },
      (response) => {
        res.writeHead(response.statusCode!, response.headers);
        response.pipe(res);
      },
    );
    upstream.on('error', () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
    return;
  }
  const path = new URL(req.url ?? '/', origin).pathname;
  const file =
    path === '/tabmirror.png' || /^\/assets\/[a-zA-Z0-9._-]+$/.test(path)
      ? path
      : '/index.html';
  try {
    res.writeHead(200, {
      'Content-Type':
        extname(file) === '.png'
          ? 'image/png'
          : extname(file) === '.js'
            ? 'text/javascript'
            : extname(file) === '.css'
              ? 'text/css'
              : 'text/html',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    });
    res.end(await readFile(resolve('apps/web/dist') + file));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
const listen = (server: typeof api, port: number) =>
  new Promise<void>((ok, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', ok);
  });
const close = (server: typeof api) =>
  new Promise<void>((ok) => {
    server.closeAllConnections();
    server.close(() => ok());
  });
let context: BrowserContext | undefined;
let phoneBrowser: Browser | undefined;
async function until(
  fn: () => Promise<boolean>,
  label: string,
  timeout = 25_000,
) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) {
      console.log(`Verified: ${label}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw Error(`Timed out: ${label}`);
}
try {
  await listen(api, 4341);
  await listen(web, 4337);
  const extensionPath = join(directory, 'extension');
  await cp(resolve('apps/extension/dist'), extensionPath, { recursive: true });
  const backgroundPath = join(extensionPath, 'background.js');
  await writeFile(
    backgroundPath,
    (await readFile(backgroundPath, 'utf8')).replaceAll(
      'http://127.0.0.1:4319',
      'http://127.0.0.1:4341',
    ),
  );
  context = await chromium.launchPersistentContext(join(directory, 'profile'), {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  const errors: string[] = [];
  context.on('weberror', (event) => errors.push(event.error().message));
  await context.route(`${issuer}/authorize**`, async (route) => {
    const url = new URL(route.request().url());
    const code = randomBytes(24).toString('hex');
    grants.set(code, {
      nonce: url.searchParams.get('nonce')!,
      challenge: url.searchParams.get('code_challenge')!,
    });
    await route.fulfill({
      status: 302,
      headers: {
        Location: `${origin}/api/auth/callback?code=${code}&state=${url.searchParams.get('state')}`,
      },
    });
  });
  await context.route('https://example.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<title>Synthetic lesson</title>',
    }),
  );
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  const popup = await context.newPage();
  await popup.goto(
    `chrome-extension://${new URL(worker.url()).host}/popup.html`,
  );
  await popup.locator('#name').fill('Pairing Test Mac');
  await popup.locator('#pair-start').click();
  await until(
    async () => !!(await popup.locator('#pairing-code').textContent()),
    'extension pairing code',
  );
  const code = (await popup.locator('#pairing-code').textContent())!;
  await popup.reload();
  await until(
    async () => (await popup.locator('#pairing-code').textContent()) === code,
    'pairing survives popup restart',
  );
  const page = await context.newPage();
  await page.goto(origin);
  assert.equal(
    await page.evaluate(async () => (await fetch('/api/devices')).status),
    401,
  );
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await page.waitForURL('**/pair');
  await page.getByText('daniel@example.test', { exact: true }).waitFor();
  const cookie = (await context.cookies()).find(
    (c) => c.name === 'tabmirror_local_session',
  );
  assert.ok(cookie?.httpOnly);
  assert.equal(cookie.sameSite, 'Lax');
  assert.equal(
    await page.evaluate(
      async (code) =>
        (
          await fetch('/api/pairings/lookup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
          })
        ).status,
      code,
    ),
    403,
  );
  await page.getByLabel('Pairing code').fill(code);
  await page.getByRole('button', { name: 'Review device' }).click();
  await page.getByRole('heading', { name: 'Confirm this device' }).waitFor();
  assert.ok(
    (await page.locator('.pair-review').textContent())?.includes(
      'Pairing Test Mac',
    ),
  );
  await page.getByRole('button', { name: 'Approve connection' }).click();
  await until(
    async () =>
      (
        await popup.evaluate(() =>
          chrome.runtime.sendMessage({ command: 'status' }),
        )
      ).state.connected,
    'approved extension connects',
  );
  await page.bringToFront();
  await page.locator('.device-row').waitFor();
  await page
    .getByText('Pairing Test Mac connected — tabs ready', { exact: true })
    .waitFor();
  console.log('Verified: pairing completion appears without manual refresh');
  const synthetic = await context.newPage();
  await synthetic.goto('https://example.test/lesson');
  await popup.locator('#sync').click();
  await until(
    async () =>
      await page.evaluate(async () => {
        const devices = await fetch('/api/devices').then((r) => r.json());
        const id = devices.devices[0]?.id;
        if (!id) return false;
        const snapshot = await fetch(`/api/devices/${id}/snapshot`).then((r) =>
          r.json(),
        );
        return JSON.stringify(snapshot.snapshot).includes(
          'https://example.test/lesson',
        );
      }),
    'paired extension uploads under signed-in owner',
  );
  assert.equal(
    await popup.evaluate(
      async () => !!(await chrome.storage.local.get('pairing')).pairing,
    ),
    false,
    'pairing secret removed',
  );
  // A separate browser represents the foreground phone: it cannot access extension APIs.
  phoneBrowser = await chromium.launch({ headless: true });
  const phoneContext = await phoneBrowser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await phoneContext.addCookies([cookie!]);
  const phone = await phoneContext.newPage();
  phone.setDefaultTimeout(270_000);
  await phone.goto(origin);
  await phone
    .getByRole('link', { name: /Synthetic lesson/ })
    .first()
    .waitFor();
  assert.ok(
    await phone
      .locator('.brand-lockup img')
      .evaluate((img) => (img as HTMLImageElement).naturalWidth > 0),
    'logo loads',
  );
  // Wait for a completed poll to measure an update near the start of a polling interval.
  await phone.waitForResponse(
    (response) =>
      response.url().endsWith('/api/devices') && response.status() === 200,
  );
  const changedAt = Date.now();
  const duplicateA = await context.newPage();
  await duplicateA.goto('https://example.test/duplicate');
  const duplicateB = await context.newPage();
  await duplicateB.goto('https://example.test/duplicate');
  const native = await popup.evaluate(async () => {
    const tabs = (await chrome.tabs.query({})).filter(
      (tab) => tab.url === 'https://example.test/duplicate',
    );
    if (tabs.length !== 2)
      throw new Error('Expected two synthetic duplicate tabs');
    const groupId = await chrome.tabs.group({
      tabIds: [tabs[0]!.id!, ...tabs.slice(1).map((tab) => tab.id!)],
    });
    await chrome.tabGroups.update(groupId, {
      title: '研究 📚 Reliability',
      color: 'purple',
      collapsed: false,
    });
    return { groupId, tabs: tabs.map((tab) => tab.id!) };
  });
  await phone
    .getByRole('button', { name: /研究 📚 Reliability/ })
    .waitFor({ timeout: 270_000 });
  const visibleMs = Date.now() - changedAt;
  assert.ok(visibleMs <= 260_000, `foreground update target: ${visibleMs}ms`);
  assert.equal(
    await phone.locator('a[href="https://example.test/duplicate"]').count(),
    2,
    'duplicate URLs stay distinct',
  );
  const longTitle = '研究 📚 — ' + 'Long title '.repeat(40);
  await synthetic.evaluate((title) => {
    document.title = title;
  }, longTitle);
  await phone
    .getByRole('link', { name: /Long title/ })
    .waitFor({ timeout: 270_000 });
  const renamedAt = Date.now();
  await popup.evaluate(async ({ groupId }) => {
    await chrome.tabGroups.update(groupId, {
      title: 'Renamed on desktop',
      color: 'orange',
    });
  }, native);
  await phone
    .getByRole('button', { name: /Renamed on desktop/ })
    .waitFor({ timeout: 270_000 });
  const renameMs = Date.now() - renamedAt;
  assert.ok(renameMs <= 260_000, `rename target: ${renameMs}ms`);
  await mkdir('artifacts', { recursive: true });
  await phone.screenshot({
    path: 'artifacts/phase7-integrated-phone.png',
    fullPage: true,
  });
  await writeFile(
    'artifacts/phase7-timing.json',
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        createdGroupVisibleMs: visibleMs,
        renamedGroupVisibleMs: renameMs,
        scope:
          'local Chromium extension to authenticated API/SQLite to separate phone-width Chromium; no manual sync or refresh',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `Verified: separate phone browser receives native group creation in ${visibleMs}ms and rename in ${renameMs}ms; duplicate URLs, Unicode/long titles and logo`,
  );
  await phoneBrowser.close();
  phoneBrowser = undefined;
  await page.getByRole('button', { name: 'Refresh devices' }).click();
  await page.locator('.device-row').waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({
    path: 'artifacts/phase5-account.png',
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    'mobile width fits',
  );
  await page.reload();
  await page.getByText('daniel@example.test', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Revoke connection' }).click();
  await until(
    async () =>
      await page
        .getByRole('button', { name: 'Revoke connection' })
        .isDisabled(),
    'website revocation',
  );
  await popup.locator('#sync').click();
  await until(
    async () =>
      (
        await popup.evaluate(() =>
          chrome.runtime.sendMessage({ command: 'status' }),
        )
      ).state.blocked,
    'extension detects revoked credential',
  );
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete device and data' }).click();
  await page.getByText('No paired devices yet.').waitFor();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('button', { name: 'Continue with Google' }).waitFor();
  assert.equal(
    await page.evaluate(async () => (await fetch('/api/devices')).status),
    401,
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS: signed synthetic OIDC + PKCE, HttpOnly session, CSRF, extension pairing/persistence, real Chrome upload, phone-width management, revoke/delete/logout. Live Google and real iPhone remain separate acceptance checks.',
  );
} catch (error) {
  const popup = context
    ?.pages()
    .find((page) => page.url().endsWith('/popup.html'));
  if (popup)
    console.error(
      'Popup status:',
      await popup.locator('#error').textContent(),
      await popup.locator('#status').textContent(),
    );
  throw error;
} finally {
  await phoneBrowser?.close();
  await context?.close();
  await close(web);
  await close(api);
  store.close();
  await rm(directory, { recursive: true, force: true });
}
