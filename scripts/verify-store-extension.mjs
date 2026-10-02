import { chromium } from 'playwright';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const { id } = JSON.parse(
  await readFile('infra/store-extension-identity.json', 'utf8'),
);
const directory = await mkdtemp(join(tmpdir(), 'tabmirror-store-check-'));
const extension = resolve('artifacts/chrome-web-store/store-id-test');
let browser;
try {
  browser = await chromium.launchPersistentContext(directory, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  const worker =
    browser.serviceWorkers()[0] ??
    (await browser.waitForEvent('serviceworker'));
  assert.equal(new URL(worker.url()).host, id);
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${id}/popup.html`);
  await page.locator('#name').fill('Store verification — synthetic');
  await page.locator('#pair-start').click();
  await page
    .locator('#pairing-code')
    .filter({ hasText: /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/ })
    .waitFor({ timeout: 30000 });
  const state = await page.evaluate(() =>
    chrome.runtime.sendMessage({ command: 'status' }),
  );
  assert.equal(state.ok, true);
  assert.ok(state.state.pairing?.expiresAt > Date.now());
  assert.equal(state.state.connected, false);
  // Cancel local polling; the unused server challenge expires after ten minutes.
  await page.evaluate(() =>
    chrome.runtime.sendMessage({ command: 'pair-cancel' }),
  );
  for (const [origin, expected] of [
    [`chrome-extension://${id}`, 204],
    ['chrome-extension://biaficlopbhcnonckljljbmcfmceaaod', 204],
    ['chrome-extension://' + 'a'.repeat(32), 403],
  ]) {
    const r = await fetch('https://tabs.portuit.com/api/pairings/start', {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    assert.equal(r.status, expected, 'Origin preflight');
  }
  const result = {
    checkedAt: new Date().toISOString(),
    id,
    chromeLoadedCorrectIdentity: true,
    productionPairingCodeCreated: true,
    legacyOriginPreserved: true,
    unknownOriginBlocked: true,
    fullReviewerSignIn: false,
    pairedUpload: false,
  };
  await writeFile(
    'artifacts/chrome-web-store/live-verification.json',
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  await rm(directory, { recursive: true, force: true });
}
