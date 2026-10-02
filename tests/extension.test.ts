import { describe, it, expect } from 'vitest';
import { capture, type BrowserReader } from '../apps/extension/src/capture';
import {
  SyncEngine,
  initialState,
  type State,
} from '../apps/extension/src/engine';
import {
  SyncError,
  httpTransport,
  type Transport,
} from '../apps/extension/src/transport';
import { makeFixture } from '../packages/contracts/src/fixtures';
const uuid = 'e5d6c901-9a8c-4ac5-bbe9-764a50adce6e';
const token = 'a'.repeat(64);
function browser(): BrowserReader {
  const tab = (id: number, url: string, groupId = -1) =>
    ({
      id,
      index: id,
      windowId: 1,
      url,
      title: `Tab ${id}`,
      groupId,
      pinned: false,
      incognito: false,
    }) as chrome.tabs.Tab;
  return {
    generation: () => 0,
    windows: async () =>
      [
        {
          id: 1,
          type: 'normal',
          incognito: false,
          focused: true,
          tabs: [
            tab(1, 'https://example.com'),
            tab(2, 'chrome://settings'),
            tab(3, 'https://example.com/a', 7),
            tab(4, 'https://example.com/b', 7),
            tab(5, 'file:///secret'),
            tab(6, 'https://user:password@example.com'),
          ],
        },
        {
          id: 2,
          type: 'normal',
          incognito: true,
          focused: false,
          tabs: [
            {
              ...tab(10, 'https://private.example'),
              windowId: 2,
              incognito: true,
            },
          ],
        },
      ] as chrome.windows.Window[],
    groups: async () =>
      [
        {
          id: 7,
          windowId: 1,
          title: 'Learning',
          color: 'blue',
          collapsed: true,
        },
      ] as chrome.tabGroups.TabGroup[],
  };
}
describe('capture', () => {
  it('retains discarded tabs as open tabs with their original metadata', async () => {
    const reader = browser();
    const windows = await reader.windows();
    const discarded = windows[0]!.tabs![2]!;
    discarded.discarded = true;
    reader.windows = async () => windows;
    const snapshot = await capture(reader, uuid, 1, () => 0);
    expect(
      snapshot.windows[0]!.tabs.find((tab) => tab.id === discarded.id),
    ).toMatchObject({
      title: discarded.title,
      url: discarded.url,
      groupId: discarded.groupId,
    });
  });

  it('treats ambiguous native focus as unknown without losing tab data', async () => {
    const r = browser();
    const original = r.windows;
    r.windows = async () => {
      const windows = await original();
      windows[1]!.incognito = false;
      windows[1]!.focused = true;
      windows[1]!.tabs![0]!.incognito = false;
      return windows;
    };
    const snapshot = await capture(r, uuid, 1, () => 0);
    expect(snapshot.windows).toHaveLength(2);
    expect(snapshot.windows.every((w) => !w.focused)).toBe(true);
  });

  it('preserves groups/order and excludes private or unsupported tabs before serialization', async () => {
    const result = await capture(browser(), uuid, 1, () => 0);
    expect(result.omittedTabCount).toBe(3);
    expect(result.windows).toHaveLength(1);
    expect(result.windows[0]!.tabs.map((t) => t.id)).toEqual([1, 3, 4]);
    expect(result.windows[0]!.groups[0]!.title).toBe('Learning');
    expect(JSON.stringify(result)).not.toMatch(
      /private.example|password|file:|chrome:/,
    );
  });
  it('retries when events occur while enumerating', async () => {
    let calls = 0;
    const r = browser();
    r.generation = () => Math.min(calls, 1);
    r.windows = async () => {
      calls++;
      if (calls === 1) throw new Error('Race');
      return [];
    };
    expect((await capture(r, uuid, 1, () => 0)).windows).toEqual([]);
  });
  it('rejects persistent capture races instead of uploading an empty fallback', async () => {
    let gen = 0;
    const r = browser();
    r.generation = () => gen++;
    await expect(capture(r, uuid, 1, () => 0)).rejects.toThrow();
  });
  it('drops empty groups/windows and accepts a true empty capture', async () => {
    const r = browser();
    r.windows = async () => [];
    expect((await capture(r, uuid, 1, () => 0)).windows).toEqual([]);
  });
});
function harness() {
  let saved: State = initialState(),
    remote = 0,
    now = 1_000_000;
  const uploads: string[] = [],
    heartbeats: unknown[] = [];
  const transport: Transport = {
    status: async () => remote,
    upload: async (_token, body) => {
      uploads.push(body);
      remote = JSON.parse(body).revision;
      return { revision: remote, receivedAt: new Date(now).toISOString() };
    },
    heartbeat: async (_token, body) => {
      heartbeats.push(body);
    },
    disconnect: async () => {},
  };
  let fixture = makeFixture('mixed');
  const ports = {
    load: async () => structuredClone(saved),
    save: async (s: State) => {
      saved = structuredClone(s);
    },
    capture: async (revision: number) => ({
      ...structuredClone(fixture),
      revision,
    }),
    transport,
    now: () => now,
    random: () => 0.5,
    hash: async (s: string) => s,
  };
  return {
    engine: new SyncEngine(ports),
    ports,
    uploads,
    heartbeats,
    transport,
    state: () => saved,
    advance: (ms = 600_000) => {
      now += ms;
    },
    setRemote: (n: number) => {
      remote = n;
    },
    empty: () => {
      fixture = makeFixture('empty');
    },
  };
}
describe('sync engine', () => {
  it('does not capture/upload before explicit connect', async () => {
    const h = harness();
    await h.engine.run();
    expect(h.uploads).toHaveLength(0);
  });
  it('uploads changes once and heartbeats unchanged state', async () => {
    const h = harness();
    await h.engine.connect(token, 'Mac');
    await h.engine.run();
    await h.engine.run();
    expect(h.uploads).toHaveLength(1);
    expect(h.heartbeats).toHaveLength(2);
    expect(await h.engine.status()).not.toHaveProperty('token');
  });
  it('serializes overlapping requests and survives recreation', async () => {
    const h = harness();
    await h.engine.connect(token, 'Mac');
    await Promise.all([h.engine.run(), h.engine.run()]);
    await new SyncEngine(h.ports).run();
    expect(h.uploads).toHaveLength(1);
    expect(h.state().revision).toBe(1);
  });
  it('recovers lost acknowledgements with a fresh higher revision', async () => {
    const h = harness();
    await h.engine.connect(token, 'Mac');
    const upload = h.transport.upload;
    h.transport.upload = async (t, b) => {
      await upload(t, b);
      throw new SyncError('lost');
    };
    await h.engine.run();
    expect(h.state().revision).toBe(1);
    expect(h.state().dirty).toBe(true);
    h.transport.upload = upload;
    h.advance();
    await new SyncEngine(h.ports).run();
    expect(h.state().revision).toBe(2);
  });
  it('backs off offline errors and reconciles server revisions', async () => {
    const h = harness();
    await h.engine.connect(token, 'Mac');
    h.setRemote(20);
    const status = h.transport.status;
    h.transport.status = async () => {
      throw new SyncError('offline');
    };
    await h.engine.run();
    expect(h.state().nextAttemptAt).toBeGreaterThan(1_000_000);
    h.transport.status = status;
    await h.engine.run();
    expect(h.uploads).toHaveLength(0);
    h.advance();
    await h.engine.run();
    expect(h.state().revision).toBe(21);
  });
  it('honors Retry-After and blocks revoked credentials', async () => {
    const h = harness();
    await h.engine.connect(token, 'Mac');
    h.transport.status = async () => {
      throw new SyncError('throttled', 429, 60_000);
    };
    await h.engine.run();
    expect(h.state().nextAttemptAt).toBe(1_060_000);
    h.transport.status = async () => {
      throw new SyncError('revoked', 401);
    };
    await h.engine.run(true);
    expect(h.state().blocked).toBe(true);
  });
  it('pauses uploads including manual sync; resumes and clears with empty snapshot', async () => {
    const h = harness();
    await h.engine.connect(token, 'Mac');
    await h.engine.run();
    await h.engine.pause(true);
    h.empty();
    await h.engine.run(true);
    expect(h.uploads).toHaveLength(1);
    await h.engine.pause(false);
    await h.engine.run(true);
    expect(JSON.parse(h.uploads[1]!).windows).toEqual([]);
  });
  it('preserves acknowledged data on capture failures', async () => {
    const h = harness();
    await h.engine.connect(token, 'Mac');
    await h.engine.run();
    h.ports.capture = async () => {
      throw new Error('capture failed');
    };
    await h.engine.run(true);
    expect(h.uploads).toHaveLength(1);
    expect(h.state().ackRevision).toBe(1);
    expect(h.state().error).toBeTruthy();
  });
  it('removes local credentials even if revocation fails', async () => {
    const h = harness();
    await h.engine.connect(token, 'Mac');
    h.transport.disconnect = async () => {
      throw new Error('offline');
    };
    await h.engine.disconnect();
    expect(h.state().token).toBeUndefined();
    expect(h.state().error).toContain('revocation could not be confirmed');
  });
  it('keeps working connection on failed replacement', async () => {
    const h = harness();
    await h.engine.connect(token, 'Mac');
    h.transport.status = async () => {
      throw new Error('bad token');
    };
    await expect(h.engine.connect('b'.repeat(64), 'Other')).rejects.toThrow();
    expect(h.state().token).toBe(token);
  });
});
describe('HTTP transport', () => {
  it('does not follow redirects and sends bearer only to fixed loopback origin', async () => {
    let options: RequestInit | undefined;
    const t = httpTransport(async (url, init) => {
      expect(String(url)).toBe('http://127.0.0.1:4319/api/device/status');
      options = init;
      return Response.json({ revision: 3 });
    });
    expect(await t.status(token)).toBe(3);
    expect(options?.redirect).toBe('error');
    expect(options?.credentials).toBe('omit');
  });
  it('rejects malformed acknowledgement', async () => {
    const t = httpTransport(async () => Response.json({ revision: 'bad' }));
    await expect(t.upload(token, '{}')).rejects.toThrow();
  });
});

it('limits automatic sync to two minutes across worker restarts while manual sync remains immediate', async () => {
  const h = harness();
  const ports = { ...h.ports, automaticIntervalMs: 120_000 };
  const engine = new SyncEngine(ports);
  await engine.connect(token, 'Mac');
  await engine.run();
  h.empty();
  await engine.dirty();
  h.advance(119_999);
  await new SyncEngine(ports).run();
  expect(h.uploads).toHaveLength(1);
  expect(h.heartbeats).toHaveLength(1);
  h.advance(1);
  await new SyncEngine(ports).run();
  expect(h.uploads).toHaveLength(2);
  await engine.run(true);
  expect(h.heartbeats).toHaveLength(3);
});

it('does not retry failed automatic sync before the cost-saving interval', async () => {
  const h = harness();
  const engine = new SyncEngine({ ...h.ports, automaticIntervalMs: 120_000 });
  await engine.connect(token, 'Mac');
  let attempts = 0;
  h.transport.status = async () => {
    attempts++;
    throw new SyncError('offline');
  };
  await engine.run();
  h.advance(60_000);
  await engine.run();
  expect(attempts).toBe(1);
  h.advance(60_000);
  await engine.run();
  expect(attempts).toBe(2);
});
