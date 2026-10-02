import { chromium, type Browser } from 'playwright';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { SqliteAuthStore } from '../apps/api/src/auth-store';
import { createPrivateApi } from '../apps/api/src/private-api';
import { WebAuth } from '../apps/api/src/web-auth';
import { digest } from '../apps/api/src/private-store';
import { makeFixture } from '../packages/contracts/src/fixtures';
import { validateSnapshot, type Snapshot } from '../packages/contracts/src';
import { testWeb } from './lib/test-web';
const origin = 'http://127.0.0.1:4343',
  apiPort = 4342;
const directory = await mkdtemp(join(tmpdir(), 'tabmirror-mobile-'));
let serverNow = Date.now();
const store = new SqliteAuthStore(
  join(directory, 'private.sqlite'),
  () => serverNow,
);
const session = store.signIn(
  {
    subject: 'synthetic-owner',
    email: 'mobile@example.test',
    emailVerified: true,
  },
  ['mobile@example.test'],
);
const verifier = 'a'.repeat(64),
  pair = store.createPairing(digest(verifier), 'Learning Mac');
store.approvePairing(digest(session.token), pair.code, pair.id, true);
const paired = store.redeemPairing(pair.id, verifier);
if (paired.status !== 'paired') throw Error('pairing');
const hash = digest(paired.token);
let revision = 0;
function upload(snapshot: Snapshot) {
  const value = validateSnapshot({ ...snapshot, revision: ++revision });
  store.upload(hash, JSON.stringify(value), value);
}
const api = createPrivateApi(store, {
  allowedHosts: [`127.0.0.1:${apiPort}`, '127.0.0.1:4343'],
  viewerOrigin: origin,
  extensionOrigin: /^chrome-extension:\/\/[a-p]{32}$/,
  auth: new WebAuth(store, {
    origin,
    local: true,
    allowedEmails: ['mobile@example.test'],
  }),
  rateLimit: 1000,
});
const web = testWeb(apiPort);
const listen = (server: Server, port: number) =>
  new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
const close = (server: Server) =>
  new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
let browser: Browser | undefined;
try {
  await listen(api, apiPort);
  await listen(web, 4343);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await context.addCookies([
    {
      name: 'tabmirror_local_session',
      value: session.token,
      url: origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);
  await page.getByText('Waiting for first sync', { exact: true }).waitFor();
  console.log('Verified: first sync pending');
  const mixed = makeFixture('mixed');
  mixed.windows[0]!.groups[0]!.collapsed = true;
  mixed.windows[0]!.tabs[0]!.title =
    '<img src=x onerror=alert(1)> Literal text';
  upload(mixed);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByLabel('Search your tabs').waitFor();
  await page
    .getByText('5 tabs · 2 windows · 1 group', { exact: true })
    .waitFor();
  assert.equal(
    await page.locator('.saved-tab img').count(),
    0,
    'titles rendered as text',
  );
  const group = page.locator('.group-disclosure').first();
  assert.equal(
    await group.getAttribute('aria-expanded'),
    'false',
    'native collapse initial preference',
  );
  await page.getByRole('button', { name: 'Collapse all', exact: true }).click();
  await page
    .getByLabel('Search your tabs')
    .fill(mixed.windows[0]!.groups[0]!.title);
  await page.getByText('2 of 5 tabs match', { exact: true }).waitFor();
  assert.equal(await page.locator('.saved-tab:visible').count(), 2);
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  assert.equal(
    await page
      .locator('.saved-window h2 button')
      .first()
      .getAttribute('aria-expanded'),
    'false',
    'search restores collapsed preference',
  );
  await page.getByRole('button', { name: 'Expand all', exact: true }).click();
  assert.deepEqual(
    await page
      .locator('.saved-tab a')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
    mixed.windows.flatMap((window) => window.tabs.map((tab) => tab.url)),
  );
  await page.getByLabel('Search your tabs').fill('definitely-no-matching-tab');
  await page.getByRole('heading', { name: 'No matching tabs' }).waitFor();
  await page.getByRole('button', { name: 'Show all tabs' }).click();
  await page.locator('.saved-tab a').first().focus();
  assert.equal(
    await page
      .locator('.saved-tab a')
      .first()
      .evaluate((link) => document.activeElement === link),
    true,
    'keyboard focus',
  );
  let referrer: string | undefined;
  await context.route('https://example.com/**', async (route) => {
    referrer = route.request().headers().referer;
    await route.fulfill({
      contentType: 'text/html',
      body: '<title>Synthetic destination</title>',
    });
  });
  const link = page.locator('.saved-tab a').first();
  assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
  const opened = context.waitForEvent('page');
  await link.click();
  const destination = await opened;
  await destination.waitForLoadState();
  assert.equal(referrer, undefined);
  assert.equal(await destination.evaluate(() => window.opener), null);
  await destination.close();
  await page.bringToFront();
  await page.getByLabel('Search your tabs').waitFor();
  await page.getByRole('button', { name: 'Expand all', exact: true }).click();
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({
    path: 'artifacts/phase6-mobile.png',
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    'no phone overflow',
  );
  await page.locator('.sync-times summary').click();
  assert.ok(
    (await page.locator('.sync-times time').count()) >= 3,
    'exact timestamps',
  );
  // Browser clock advances only; the server's last verification remains the saved time.
  await page.clock.install();
  await page.clock.fastForward(6 * 60_000);
  await page.getByText('Connection uncertain', { exact: true }).waitFor();
  console.log(
    'Verified: hierarchy/search, collapse restoration, safe links, keyboard focus and freshness',
  );
  serverNow = Date.now();
  store.heartbeat(hash, {
    revision,
    state: 'paused',
    deviceName: 'Learning Mac',
  });
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByText('Sync paused', { exact: true }).waitFor();
  upload(makeFixture('empty'));
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByRole('heading', { name: 'No open web tabs' }).waitFor();
  const large = makeFixture('large');
  const payloadBytes = Buffer.byteLength(JSON.stringify(large));
  const largeStarted = performance.now();
  upload(large);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page
    .getByText('1000 tabs · 20 windows · 100 groups', { exact: true })
    .waitFor();
  const largeVisibleMs = performance.now() - largeStarted;
  const searchStarted = performance.now();
  await page.getByLabel('Search your tabs').fill('Learning collection 100');
  await page.getByText('10 of 1000 tabs match', { exact: true }).waitFor();
  assert.equal(await page.locator('.saved-tab:visible').count(), 10);
  const searchMs = performance.now() - searchStarted;
  const cdp = await context.newCDPSession(page);
  const heap = await cdp.send('Runtime.getHeapUsage');
  await writeFile(
    'artifacts/phase7-capacity.json',
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        tabs: 1000,
        payloadBytes,
        largeVisibleMs,
        searchMs,
        heapUsedBytes: heap.usedSize,
        scope:
          'desktop Chromium at 390px width; includes test browser overhead; not physical iPhone measurements',
      },
      null,
      2,
    ) + '\n',
  );
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await page.route('**/api/devices/*/snapshot', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { message: 'Synthetic storage outage' } }),
    }),
  );
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page
    .getByRole('alert')
    .filter({ hasText: 'Synthetic storage outage' })
    .waitFor();
  assert.ok(
    (await page.locator('.saved-tab:visible').count()) > 0,
    'last valid data retained with error',
  );
  await page.unroute('**/api/devices/*/snapshot');
  await page.getByRole('button', { name: 'Retry loading tabs' }).click();
  await page
    .getByRole('button', { name: 'Retry loading tabs' })
    .waitFor({ state: 'hidden' });
  await page.route('**/api/devices/*/snapshot', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        device: { id: paired.deviceId },
        snapshot: {
          ...mixed,
          windows: [
            {
              ...mixed.windows[0],
              tabs: [
                { ...mixed.windows[0]!.tabs[0], url: 'javascript:alert(1)' },
              ],
            },
          ],
        },
      }),
    }),
  );
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByRole('button', { name: 'Retry loading tabs' }).waitFor();
  assert.equal(await page.locator('a[href^="javascript:"]').count(), 0);
  await page.unroute('**/api/devices/*/snapshot');
  console.log(
    'Verified: paused/empty/1000-tab views, storage failure recovery and unsafe payload rejection',
  );
  // A revoked connection keeps its last snapshot accessible to its owner.
  store.revoke(digest(session.token), paired.deviceId);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByText('Connection revoked', { exact: true }).waitFor();
  const other = await context.newPage();
  await other.goto(origin);
  await other.locator('.saved-tab').first().waitFor();
  await page.bringToFront();
  await page.getByRole('button', { name: 'Account & devices' }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('button', { name: 'Continue with Google' }).waitFor();
  await other.getByRole('button', { name: 'Continue with Google' }).waitFor();
  assert.equal(
    await other.locator('.saved-tab').count(),
    0,
    'logout clears another open tab',
  );
  assert.equal(await page.locator('.saved-tab').count(), 0);
  await page.reload();
  await page.getByRole('button', { name: 'Continue with Google' }).waitFor();
  assert.equal(await page.locator('.saved-tab').count(), 0);
  assert.equal(
    await page.evaluate(async () => (await fetch('/api/devices')).status),
    401,
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS: mobile browser, 1000 tabs, authenticated saved-state handling and logout privacy. No real account or paired device used.',
  );
} finally {
  await browser?.close();
  await close(web);
  await close(api);
  store.close();
  await rm(directory, { recursive: true, force: true });
}
