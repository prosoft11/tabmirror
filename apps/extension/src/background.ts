declare const TABMIRROR_WEB_ORIGIN: string | undefined;
import { PairingEngine, type PairingState } from './pairing';
import { capture } from './capture';
import { SyncEngine, type State } from './engine';
import { httpTransport } from './transport';
import { AUTOMATIC_SYNC_INTERVAL_MS } from '@tabmirror/contracts';
let generation = 0;
const ready = (async () => {
  await chrome.storage.local.setAccessLevel({
    accessLevel: 'TRUSTED_CONTEXTS',
  });
  await chrome.storage.session.setAccessLevel({
    accessLevel: 'TRUSTED_CONTEXTS',
  });
  const session = await chrome.storage.session.get('browserSessionId');
  if (!session.browserSessionId)
    await chrome.storage.session.set({ browserSessionId: crypto.randomUUID() });
})();
const engine = new SyncEngine({
  automaticIntervalMs: AUTOMATIC_SYNC_INTERVAL_MS,
  async load() {
    await ready;
    return (await chrome.storage.local.get('sync')).sync as State | undefined;
  },
  async save(state) {
    await chrome.storage.local.set({ sync: state });
    await chrome.action.setBadgeText({
      text: state.error ? '!' : state.paused ? 'Ⅱ' : '',
    });
    if (state.nextAttemptAt && !state.blocked && state.token)
      await chrome.alarms.create('retry-sync', {
        when: Math.max(Date.now() + 30_000, state.nextAttemptAt),
      });
    else await chrome.alarms.clear('retry-sync');
    if (state.token && state.automaticAfter)
      await chrome.alarms.create('recover-sync', {
        when: Math.max(Date.now() + 1000, state.automaticAfter),
        periodInMinutes: AUTOMATIC_SYNC_INTERVAL_MS / 60_000,
      });
  },
  async capture(revision) {
    await ready;
    const session = await chrome.storage.session.get('browserSessionId');
    return capture(
      {
        windows: () =>
          chrome.windows.getAll({ populate: true, windowTypes: ['normal'] }),
        groups: () => chrome.tabGroups.query({}),
        generation: () => generation,
      },
      session.browserSessionId as string,
      revision,
      Date.now,
    );
  },
  transport: httpTransport(),
  now: Date.now,
  random: Math.random,
  async hash(value) {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(value),
    );
    return Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
  },
});
const pairing = new PairingEngine({
  async load() {
    await ready;
    return (await chrome.storage.local.get('pairing')).pairing as
      PairingState | undefined;
  },
  async save(state) {
    if (state) {
      await chrome.storage.local.set({ pairing: state });
      await chrome.alarms.create('pairing-poll', { periodInMinutes: 0.5 });
    } else {
      await chrome.storage.local.remove('pairing');
      await chrome.alarms.clear('pairing-poll');
    }
  },
  async connect(token, name) {
    await engine.connect(token, name);
    await engine.run(true);
  },
  now: Date.now,
  fetch,
});
async function status() {
  return { ...(await engine.status()), pairing: await pairing.view() };
}
function safe(work: Promise<unknown>) {
  void work.catch(() => chrome.action.setBadgeText({ text: '!' }));
}
function changed() {
  generation++;
  safe(engine.dirty());
}
chrome.tabs.onCreated.addListener(changed);
chrome.tabs.onRemoved.addListener(changed);
chrome.tabs.onMoved.addListener(changed);
chrome.tabs.onAttached.addListener(changed);
chrome.tabs.onDetached.addListener(changed);
chrome.tabs.onUpdated.addListener((_id, info) => {
  if (
    ['url', 'title', 'groupId', 'pinned', 'status'].some((key) => key in info)
  )
    changed();
});
chrome.tabGroups.onCreated.addListener(changed);
chrome.tabGroups.onUpdated.addListener(changed);
chrome.tabGroups.onMoved.addListener(changed);
chrome.tabGroups.onRemoved.addListener(changed);
chrome.windows.onCreated.addListener(changed);
chrome.windows.onRemoved.addListener(changed);
chrome.windows.onFocusChanged.addListener(changed);
async function recover() {
  await ready;
  if (!(await chrome.alarms.get('recover-sync')))
    await chrome.alarms.create('recover-sync', { periodInMinutes: 2 });
  await pairing.poll();
  await engine.run();
}
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'pairing-poll') safe(pairing.poll());
  if (['recover-sync', 'retry-sync'].includes(alarm.name)) safe(recover());
});
chrome.runtime.onStartup.addListener(() => safe(recover()));
chrome.runtime.onInstalled.addListener(() => safe(recover()));
chrome.runtime.onMessage.addListener((message: unknown, sender, reply) => {
  if (
    sender.id !== chrome.runtime.id ||
    !sender.url?.startsWith(chrome.runtime.getURL('popup.html'))
  )
    return false;
  const m = message as {
    command?: string;
    token?: string;
    name?: string;
    paused?: boolean;
  };
  const action = async () => {
    switch (m.command) {
      case 'status':
        return status();
      case 'pair-start':
        if (typeof m.name !== 'string') throw new Error('Invalid name.');
        if ((await engine.status()).connected)
          throw new Error('Disconnect before pairing.');
        await pairing.start(m.name);
        break;
      case 'pair-poll':
        await pairing.poll();
        break;
      case 'pair-cancel':
        await pairing.cancel();
        break;
      case 'pair-open':
        await chrome.tabs.create({
          url: `${typeof TABMIRROR_WEB_ORIGIN === 'undefined' ? 'http://127.0.0.1:4317' : TABMIRROR_WEB_ORIGIN}/pair`,
        });
        break;
      case 'connect':
        if (typeof m.token !== 'string' || typeof m.name !== 'string')
          throw new Error('Invalid connection.');
        await engine.connect(m.token, m.name);
        await engine.run(true);
        break;
      case 'rename':
        if (typeof m.name !== 'string') throw new Error('Invalid name.');
        await engine.rename(m.name);
        await engine.run(true);
        break;
      case 'sync':
        await engine.run(true);
        break;
      case 'pause':
        if (typeof m.paused !== 'boolean')
          throw new Error('Invalid pause state.');
        await engine.pause(m.paused);
        await engine.run(true);
        break;
      case 'disconnect':
        await pairing.cancel();
        await engine.disconnect();
        break;
      default:
        throw new Error('Unknown command.');
    }
    return status();
  };
  void action()
    .then((state) => reply({ ok: true, state }))
    .catch(() =>
      reply({
        ok: false,
        error:
          'Action failed. Check that the API is running and the device name is valid, then retry.',
      }),
    );
  return true;
});
safe(recover());
