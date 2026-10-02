// Screenshots use only synthetic data and browser-rendered UI. No live account is accessed.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, cp, readdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { makeFixture } from '../packages/contracts/src/fixtures';
const out = resolve('artifacts/chrome-web-store');
await mkdir(out, { recursive: true });
const web = resolve('artifacts/production/web');
const server = createServer(async (req, res) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  const file = path === '/' || path === '/pair' ? '/index.html' : path;
  if (file.includes('..')) {
    res.writeHead(400).end();
    return;
  }
  try {
    const bytes = await readFile(web + file);
    res.setHeader(
      'Content-Type',
      (
        {
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.png': 'image/png',
          '.html': 'text/html',
        } as Record<string, string>
      )[extname(file)] ?? 'application/octet-stream',
    );
    res.end(bytes);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const address = server.address();
if (!address || typeof address === 'string') throw Error('No listener');
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  const now = new Date().toISOString();
  const device = {
    id: 'store-example',
    name: 'Example desktop',
    status: 'active',
    revision: 1,
    receivedAt: now,
    lastContactAt: now,
    lastVerifiedAt: now,
    lastContentChangedAt: now,
  };
  const snapshot = makeFixture('mixed');
  snapshot.capturedAt = now;
  snapshot.revision = device.revision;
  snapshot.windows[0]!.groups[0]!.collapsed = false;
  let devices = [device];
  let approveCount = 0;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown;
    if (path === '/api/session')
      body = {
        authenticated: true,
        email: 'demo@example.test',
        csrfToken: 'synthetic-csrf',
        googleConfigured: true,
      };
    else if (path === '/api/devices') body = { devices };
    else if (path.endsWith('/snapshot'))
      body = {
        device,
        snapshot,
        receivedAt: now,
        lastContactAt: now,
        lastVerifiedAt: now,
        lastContentChangedAt: now,
      };
    else if (path === '/api/pairings/lookup')
      body = {
        id: 'synthetic-pair',
        code: 'ABCDEFGH',
        name: 'Example desktop',
        expiresAt: Date.now() + 600000,
      };
    else if (path === '/api/pairings/approve') {
      approveCount++;
      await new Promise((r) => setTimeout(r, 1200));
      body = { ok: true };
    } else throw Error(`Unexpected test route ${path}`);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
  await page.goto(origin);
  await page.getByLabel('Search your tabs').waitFor();
  await page.evaluate(() => window.scrollTo(0, 300));
  await page.screenshot({ path: `${out}/01-grouped-tabs.png` });
  await page.getByLabel('Search your tabs').fill('Learning');
  await page.screenshot({ path: `${out}/02-search.png` });
  // Verify approval scrolls to the status area while the request is still pending.
  devices = [];
  await page.setViewportSize({ width: 390, height: 844 });
  for (const motion of ['reduce', 'no-preference'] as const) {
    await page.emulateMedia({ reducedMotion: motion });
    await page.goto(origin + '/pair');
    await page.getByLabel('Pairing code').fill('ABCDEFGH');
    await page
      .getByRole('button', { name: 'Review device', exact: true })
      .click();
    const approve = page.getByRole('button', {
      name: 'Approve connection',
      exact: true,
    });
    await approve.scrollIntoViewIfNeeded();
    assert.ok((await page.evaluate(() => scrollY)) > 100);
    await approve.click();
    await page.waitForFunction(() => {
      const r = document
        .querySelector('[aria-label="Connection status"]')
        ?.getBoundingClientRect();
      return r && r.top >= -1 && r.top < 100;
    });
    await page
      .getByText('Connecting Example desktop…', { exact: true })
      .waitFor();
    await page.waitForFunction(() => {
      const r = document
        .querySelector('.pair-progress')
        ?.getBoundingClientRect();
      return r && r.top >= 0 && r.top < 300;
    });
    const rect = await page.locator('.pair-progress').boundingBox();
    assert.ok(
      rect && rect.y >= 0 && rect.y < 300,
      'Connection progress is visible without manual scrolling',
    );
    assert.equal(
      await page
        .getByLabel('Connection status')
        .evaluate((e) => document.activeElement === e),
      true,
    );
  }
  assert.equal(approveCount, 2);
  await page.screenshot({ path: `${out}/mobile-approval-verification.png` });
  // Render the supplied logo at the exact pixel sizes needed by the manifest.
  const art = await browser.newPage();
  const logo =
    'data:image/png;base64,' +
    (await readFile('apps/extension/tabmirror.png')).toString('base64');
  await cp('artifacts/production/extension', `${out}/extension`, {
    recursive: true,
  });
  await mkdir(`${out}/extension/icons`, { recursive: true });
  for (const size of [16, 32, 48, 128]) {
    await art.setViewportSize({ width: size, height: size });
    await art.setContent(
      `<style>body{margin:0;background:transparent;display:grid;place-items:center;width:100vw;height:100vh}img{width:75vw;height:75vh}</style><img src="${logo}">`,
    );
    await art.locator('img').evaluate((el: HTMLImageElement) => el.decode());
    await art.screenshot({
      path: `${out}/extension/icons/icon-${size}.png`,
      omitBackground: true,
    });
  }
  await cp(`${out}/extension/icons/icon-128.png`, `${out}/icon-128.png`);
  await art.setViewportSize({ width: 440, height: 280 });
  await art.setContent(
    `<style>body{margin:0;background:#122f42;color:white;font:16px system-ui;display:flex;align-items:center;gap:22px;height:280px;padding:32px;box-sizing:border-box}img{width:110px;border-radius:25px}h1{font-size:32px;letter-spacing:-1px;margin:0 0 12px}p{line-height:1.5;color:#d5e8ed;margin:0}</style><img src="${logo}"><div><h1>TabMirror</h1><p>Your Chrome tabs.<br>Ready on your phone.</p></div>`,
  );
  await art.locator('img').evaluate((el: HTMLImageElement) => el.decode());
  await art.screenshot({ path: `${out}/promo-440x280.png` });
  const manifest = JSON.parse(
    await readFile(`${out}/extension/manifest.json`, 'utf8'),
  );
  delete manifest.key; // The Store allocates its own item ID; authorize it before submission.
  manifest.homepage_url = 'https://tabs.portuit.com/support.html';
  manifest.icons = Object.fromEntries(
    [16, 32, 48, 128].map((size) => [size, `icons/icon-${size}.png`]),
  );
  manifest.action.default_icon = {
    16: 'icons/icon-16.png',
    32: 'icons/icon-32.png',
  };
  await writeFile(
    `${out}/extension/manifest.json`,
    JSON.stringify(manifest, null, 2) + '\n',
  );
  const zip = `${out}/tabmirror-store-${manifest.version}.zip`;
  // ZIP receives only the extension directory, never repository or account data.
  execFileSync(
    '/usr/bin/zip',
    ['-q', '-r', zip, ...(await readdir(`${out}/extension`))],
    { cwd: `${out}/extension` },
  );
  const storeIdentity = JSON.parse(
    await readFile('infra/store-extension-identity.json', 'utf8'),
  );
  await cp(`${out}/extension`, `${out}/store-id-test`, { recursive: true });
  await writeFile(
    `${out}/store-id-test/manifest.json`,
    JSON.stringify({ ...manifest, key: storeIdentity.key }, null, 2) + '\n',
  );
  await writeFile(
    `${out}/verification.json`,
    JSON.stringify(
      {
        syntheticDataOnly: true,
        mobileApprovalScroll: true,
        reducedMotion: true,
        screenshots: [1280, 800],
        promo: [440, 280],
        version: manifest.version,
        storeId: storeIdentity.id,
        storeIdPending: false,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'Prepared Store ZIP and Store-ID unpacked test build; mobile scroll checks passed. Reviewer sign-in still requires verification.',
  );
} finally {
  await browser.close();
  await new Promise<void>((r) => server.close(() => r()));
}
