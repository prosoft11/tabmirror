import { chromium, type BrowserContext, type Page } from 'playwright';
import { mkdtemp, mkdir, rm, cp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { createCollector } from '../apps/api/src/collector';
import { createPrivateApi } from '../apps/api/src/private-api';
import { SqlitePrivateStore } from '../apps/api/src/sqlite-store';
const privateMode = process.argv.includes('--private');
const dataDirectory = await mkdtemp(join(tmpdir(), 'tabmirror-durable-'));
let durable = privateMode
  ? new SqlitePrivateStore(join(dataDirectory, 'private.sqlite'))
  : undefined;
const credentials = durable?.provision('synthetic-owner');
const token = credentials?.deviceToken ?? randomBytes(32).toString('hex');
const makeServer = () =>
  durable
    ? createPrivateApi(durable, {
        allowedHosts: ['127.0.0.1:4344'],
        viewerOrigin: 'http://127.0.0.1:4317',
        extensionOrigin: /^chrome-extension:\/\/[a-p]{32}$/,
        rateLimit: 600,
      })
    : createCollector(token);
let collector = makeServer();
const listen = () =>
  new Promise<void>((ok, fail) => {
    collector.once('error', fail);
    collector.listen(4344, '127.0.0.1', ok);
  });
const closeCollector = () =>
  new Promise<void>((ok) => {
    collector.closeAllConnections();
    collector.close(() => ok());
  });
const profile = await mkdtemp(join(tmpdir(), 'tabmirror-extension-'));
let context: BrowserContext | undefined;
async function until<T>(
  read: () => Promise<T>,
  check: (v: T) => boolean,
  label: string,
  timeout = 150_000,
): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await read();
    if (check(value)) {
      console.log(`Verified: ${label}`);
      return value;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out: ${label}`);
}
const read = async () => {
  const path = credentials
    ? `/api/devices/${credentials.deviceId}/snapshot`
    : '/api/devices/local/snapshot';
  const r = await fetch(`http://127.0.0.1:4344${path}`, {
    headers: { Authorization: `Bearer ${credentials?.viewerToken ?? token}` },
  });
  assert.equal(r.status, 200);
  const value = await r.json();
  return credentials
    ? {
        ...value,
        deviceName: value.device.name,
        paused: value.device.status === 'paused',
      }
    : value;
};
const status = (page: Page) =>
  page.evaluate(() => chrome.runtime.sendMessage({ command: 'status' }));
const extensionPath = join(dataDirectory, 'extension');
await cp(resolve('apps/extension/dist'), extensionPath, { recursive: true });
const backgroundPath = join(extensionPath, 'background.js');
await writeFile(
  backgroundPath,
  (await readFile(backgroundPath, 'utf8')).replaceAll(
    'http://127.0.0.1:4319',
    'http://127.0.0.1:4344',
  ),
);
const launch = async () => {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  await context.route('https://example.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<title>Learning example</title><p>Synthetic extension test</p>',
    }),
  );
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  return popup;
};
try {
  await listen();
  let popup = await launch();
  await popup.locator('#name').fill('Test Mac');
  await popup.locator('#manual summary').click();
  await popup.locator('#token').fill(token);
  await popup.locator('#connect').click();
  await until(
    () => status(popup),
    (s) => s.ok && s.state.connected && !s.state.error,
    'connect',
  );
  const created = await popup.evaluate(async () => {
    const w = await chrome.windows.create({
      type: 'normal',
      url: [
        'https://example.test/a',
        'https://example.test/b',
        'https://example.test/c',
      ],
    });
    if (!w?.id) throw new Error('no window');
    const tabs = await chrome.tabs.query({ windowId: w.id });
    const id = await chrome.tabs.group({
      tabIds: [tabs[1]!.id!, ...tabs.slice(2).map((t) => t.id!)],
      createProperties: { windowId: w.id },
    });
    await chrome.tabGroups.update(id, {
      title: 'AI Learning',
      color: 'blue',
      collapsed: true,
    });
    await chrome.tabs.create({ windowId: w.id, url: 'chrome://settings' });
    return { windowId: w.id, groupId: id, tabId: tabs[1]!.id! };
  });
  let record = await until(
    read,
    (r) =>
      r.snapshot?.windows.some((w: any) =>
        w.groups.some((g: any) => g.title === 'AI Learning'),
      ),
    'automatic capture',
  );
  assert.equal(record.snapshot.windows.flatMap((w: any) => w.tabs).length, 3);
  assert.ok(record.snapshot.omittedTabCount >= 1);
  assert.ok(!JSON.stringify(record.snapshot).includes('chrome://'));
  await popup.evaluate(async ({ groupId }) => {
    await chrome.tabGroups.update(groupId, {
      title: 'Renamed group',
      color: 'green',
    });
  }, created);
  await until(
    read,
    (r) =>
      r.snapshot?.windows.some((w: any) =>
        w.groups.some(
          (g: any) => g.title === 'Renamed group' && g.color === 'green',
        ),
      ),
    'rename/recolor auto sync',
  );

  const nativeOrder = await popup.evaluate(
    async ({ windowId }) =>
      (await chrome.tabs.query({ windowId }))
        .filter((t) => t.url?.startsWith('https://example.test/'))
        .sort((a, b) => a.index - b.index)
        .map((t) => t.id),
    created,
  );
  assert.deepEqual(
    record.snapshot.windows
      .find((w: any) => w.id === created.windowId)
      .tabs.map((t: any) => t.id),
    nativeOrder,
  );
  const destination = await popup.evaluate(async ({ groupId }) => {
    const w = await chrome.windows.create({
      type: 'normal',
      url: 'about:blank',
    });
    await chrome.tabGroups.move(groupId, { windowId: w!.id!, index: 0 });
    return w!.id!;
  }, created);
  await until(
    read,
    (r) =>
      r.snapshot?.windows.some(
        (w: any) =>
          w.id === destination &&
          w.groups.some((g: any) => g.title === 'Renamed group'),
      ),
    'cross-window group move',
  );
  await popup.evaluate(async ({ tabId }) => {
    await chrome.tabs.ungroup(tabId);
    await chrome.tabs.update(tabId, { pinned: true });
  }, created);
  await until(
    read,
    (r) =>
      r.snapshot?.windows.some((w: any) =>
        w.tabs.some(
          (t: any) => t.id === created.tabId && t.groupId === null && t.pinned,
        ),
      ),
    'ungroup and pin',
  );
  await popup.evaluate(async ({ tabId }) => {
    await chrome.tabs.remove(tabId);
  }, created);
  await until(
    read,
    (r) => r.snapshot?.windows.flatMap((w: any) => w.tabs).length === 2,
    'tab removal',
  );
  await popup.locator('#name').fill('Renamed Mac');
  await popup.locator('#rename').click();
  await until(read, (r) => r.deviceName === 'Renamed Mac', 'device rename');
  assert.equal(await popup.locator('#token-label').isVisible(), false);
  await popup.locator('#pause').click();
  await until(
    () => status(popup),
    (s) => s.state.paused,
    'pause',
  );
  const pausedRevision = (await read()).snapshot.revision;
  await popup.evaluate(async () => {
    await chrome.tabs.create({ url: 'https://example.test/paused' });
  });
  await new Promise((r) => setTimeout(r, 3500));
  assert.equal((await read()).snapshot.revision, pausedRevision);
  await popup.locator('#pause').click();
  record = await until(
    read,
    (r) => r.snapshot?.revision > pausedRevision,
    'resume',
  );
  const beforeWorker = record.snapshot.browserSessionId;
  // Stop the actual MV3 worker and wake it through a message. Session storage must survive.
  const cdp = await context!.newCDPSession(popup);
  let versionId: string | undefined;
  cdp.on('ServiceWorker.workerVersionUpdated', (event) => {
    for (const v of event.versions)
      if (
        v.scriptURL.endsWith('/background.js') &&
        v.runningStatus === 'running'
      )
        versionId = v.versionId;
  });
  await cdp.send('ServiceWorker.enable');
  await until(
    async () => versionId,
    (v) => !!v,
    'worker discovery',
  );
  await cdp.send('ServiceWorker.stopWorker', { versionId: versionId! });
  await until(
    () => status(popup),
    (s) => s.ok && s.state.connected,
    'worker restart',
  );
  assert.equal((await read()).snapshot.browserSessionId, beforeWorker);
  await closeCollector();
  await popup.locator('#sync').click();
  await until(
    () => status(popup),
    (s) => !!s.state.error,
    'offline error',
  );
  if (durable) {
    durable.close();
    durable = new SqlitePrivateStore(join(dataDirectory, 'private.sqlite'));
  }
  collector = makeServer();
  await listen();
  if (privateMode)
    assert.equal((await read()).snapshot.browserSessionId, beforeWorker);
  const beforeRecoveryContact = privateMode
    ? (await read()).lastContactAt
    : null;
  // Use the real alarm callback, accelerated only for this test.
  await popup.evaluate(() =>
    chrome.alarms.create('recover-sync', { when: Date.now() + 500 }),
  );
  record = await until(
    read,
    (r) =>
      privateMode ? r.lastContactAt > beforeRecoveryContact : !!r.snapshot,
    'alarm reconnect',
    45_000,
  );
  assert.ok(record.snapshot.revision > pausedRevision);
  await until(
    () => status(popup),
    (s) => !s.state.error,
    'error cleared',
  );
  await mkdir('artifacts', { recursive: true });
  await popup.setViewportSize({ width: 390, height: 850 });
  await popup.screenshot({
    path: privateMode
      ? 'artifacts/phase4-extension.png'
      : 'artifacts/phase3-extension.png',
  });
  const previousSession = record.snapshot.browserSessionId;
  const previousRevision = record.snapshot.revision;
  await context!.close();
  context = undefined;
  popup = await launch();
  record = await until(
    read,
    (r) =>
      r.snapshot?.browserSessionId !== previousSession &&
      r.snapshot?.revision > previousRevision,
    'browser restart',
  );
  assert.ok((await status(popup)).state.connected);
  await popup.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs)
      if (tab.url?.startsWith('https://example.test/'))
        await chrome.tabs.remove(tab.id!);
  });
  await popup.locator('#sync').click();
  await until(
    read,
    (r) => r.snapshot?.windows.length === 0,
    'empty snapshot clears old tabs',
  );
  await popup.locator('#disconnect').click();
  await until(
    () => status(popup),
    (s) => !s.state.connected,
    'disconnect',
  );
  assert.equal(
    (
      await fetch('http://127.0.0.1:4344/api/device/status', {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).status,
    401,
  );
  console.log(
    'PASS: actual Chromium capture/groups/order, automatic changes, rename, pause/resume, worker termination, offline/alarm recovery, browser restart, empty snapshot, and disconnect/revocation.',
  );
} catch (error) {
  const page = context?.pages().find((p) => p.url().includes('/popup.html'));
  if (page) {
    const result = await status(page).catch(() => null);
    console.error('Extension diagnostic:', JSON.stringify(result));
    console.error(
      'Native diagnostic:',
      JSON.stringify(
        await page.evaluate(async () => ({
          windows: await chrome.windows.getAll({ populate: true }),
          groups: await chrome.tabGroups.query({}),
          session: await chrome.storage.session.get('browserSessionId'),
        })),
      ),
    );
  }
  console.error(
    'Collector diagnostic:',
    JSON.stringify(await read().catch(() => ({ unavailable: true }))),
  );
  throw error;
} finally {
  await context?.close();
  await closeCollector();
  durable?.close();
  await rm(dataDirectory, { recursive: true, force: true });
  await rm(profile, { recursive: true, force: true });
}
