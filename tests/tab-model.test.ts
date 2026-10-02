import { expect, it } from 'vitest';
import { makeFixture } from '../packages/contracts/src/fixtures';
import {
  age,
  freshness,
  safeLink,
  tabRuns,
  type Device,
} from '../apps/web/src/tab-model';
const now = Date.parse('2026-09-25T12:00:00Z');
const device: Device = {
  id: 'test',
  name: 'Test',
  status: 'active',
  revision: 42,
  receivedAt: new Date(now).toISOString(),
  lastContactAt: new Date(now).toISOString(),
  lastVerifiedAt: new Date(now).toISOString(),
  lastContentChangedAt: new Date(now).toISOString(),
};
it('preserves native tab order including ungrouped runs before and after a group', () => {
  const window = makeFixture('mixed').windows[0]!;
  const groups = tabRuns(window);
  expect(groups.flatMap((run) => run.tabs.map((tab) => tab.id))).toEqual(
    window.tabs.map((tab) => tab.id),
  );
  expect(groups.map((run) => run.group?.id ?? null)).toEqual([null, 7, null]);
});
it('searches titles and URLs case-insensitively and group-name matches reveal all group tabs', () => {
  const window = makeFixture('mixed').windows[0]!;
  window.groups[0]!.title = 'Medical Learning';
  window.tabs[0]!.title = 'Distinct title';
  const before = structuredClone(window);
  expect(tabRuns(window, 'DISTINCT').flatMap((run) => run.tabs)).toEqual([
    window.tabs[0],
  ]);
  expect(
    tabRuns(window, 'medical learning').flatMap((run) => run.tabs),
  ).toEqual(window.tabs.filter((tab) => tab.groupId === 7));
  expect(
    tabRuns(window, window.tabs[0]!.url).flatMap((run) => run.tabs),
  ).toContainEqual(window.tabs[0]);
  expect(tabRuns(window, 'nothing matches')).toEqual([]);
  expect(tabRuns(window, '   ').flatMap((run) => run.tabs)).toEqual(
    window.tabs,
  );
  expect(window).toEqual(before);
});
it('handles the 1000-tab capacity while retaining hierarchy', () => {
  const snapshot = makeFixture('large');
  expect(
    snapshot.windows
      .flatMap((window) => tabRuns(window, 'Learning collection 100'))
      .flatMap((run) => run.tabs),
  ).toHaveLength(10);
  expect(
    snapshot.windows
      .flatMap((window) => tabRuns(window))
      .flatMap((run) => run.tabs),
  ).toHaveLength(1000);
});
it('distinguishes pending, paused, revoked, stale and recent verification without trusting recent contact alone', () => {
  expect(freshness(device, now).kind).toBe('fresh');
  expect(freshness({ ...device, revision: 0 }, now).kind).toBe('pending');
  expect(freshness({ ...device, status: 'paused' }, now).kind).toBe('paused');
  expect(freshness({ ...device, status: 'revoked' }, now).kind).toBe('revoked');
  expect(
    freshness(
      { ...device, lastVerifiedAt: new Date(now - 301_000).toISOString() },
      now,
    ).kind,
  ).toBe('stale');
  expect(freshness({ ...device, lastVerifiedAt: null }, now).kind).toBe(
    'stale',
  );
  expect(
    freshness(
      { ...device, lastVerifiedAt: new Date(now + 120_000).toISOString() },
      now,
    ).kind,
  ).toBe('stale');
});
it('formats relative ages and only permits HTTP(S) links without embedded credentials', () => {
  expect(age(null, now)).toBe('Not yet');
  expect(age(device.receivedAt, now)).toBe('just now');
  expect(age(new Date(now - 120_000).toISOString(), now)).toBe('2 min ago');
  expect(safeLink('https://example.test/path?query=1#section')).toBe(
    'https://example.test/path?query=1#section',
  );
  for (const value of [
    'javascript:alert(1)',
    'data:text/html,test',
    'file:///tmp/test',
    'https://user:pass@example.test',
    'https://example.test/ a',
  ])
    expect(safeLink(value)).toBeUndefined();
});
