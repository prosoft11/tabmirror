import {
  isEligibleUrl,
  type Snapshot,
  type SnapshotTab,
  type SnapshotWindow,
} from '@tabmirror/contracts';
export interface Device {
  id: string;
  name: string;
  status: 'active' | 'paused' | 'revoked';
  revision: number;
  receivedAt: string | null;
  lastContactAt: string | null;
  lastVerifiedAt: string | null;
  lastContentChangedAt: string | null;
}
export interface Envelope {
  device: Device;
  snapshot: Snapshot | null;
  receivedAt: string | null;
  lastContactAt: string | null;
  lastVerifiedAt: string | null;
  lastContentChangedAt: string | null;
}
export interface TabRun {
  key: string;
  group: SnapshotWindow['groups'][number] | undefined;
  tabs: SnapshotTab[];
}
export function tabRuns(window: SnapshotWindow, query = ''): TabRun[] {
  const runs: TabRun[] = [];
  const groups = new Map(window.groups.map((group) => [group.id, group]));
  for (const tab of window.tabs) {
    const group = tab.groupId === null ? undefined : groups.get(tab.groupId);
    const last = runs.at(-1);
    if (last && last.group?.id === group?.id) last.tabs.push(tab);
    else
      runs.push({
        key: group ? `group-${group.id}` : `ungrouped-${tab.id}`,
        group,
        tabs: [tab],
      });
  }
  const term = query.trim().toLocaleLowerCase();
  if (!term) return runs;
  return runs
    .map((run) => ({
      ...run,
      tabs: (run.group?.title || '').toLocaleLowerCase().includes(term)
        ? run.tabs
        : run.tabs.filter((tab) =>
            `${tab.title}\n${tab.url}`.toLocaleLowerCase().includes(term),
          ),
    }))
    .filter((run) => run.tabs.length);
}
export function safeLink(url: string): string | undefined {
  return isEligibleUrl(url) ? url : undefined;
}
export function age(timestamp: string | null, now: number): string {
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return 'Not yet';
  const seconds = Math.max(0, Math.floor((now - Date.parse(timestamp)) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
  return `${Math.floor(seconds / 86400)} days ago`;
}
export function freshness(device: Device, now: number) {
  if (device.status === 'revoked')
    return {
      kind: 'revoked',
      label: 'Connection revoked',
      message:
        'This device can no longer upload. Its last saved tabs remain available until you delete it.',
    };
  if (device.status === 'paused')
    return {
      kind: 'paused',
      label: 'Sync paused',
      message:
        'Showing the last saved tabs. Resume sync in the desktop extension to update them.',
    };
  if (!device.revision)
    return {
      kind: 'pending',
      label: 'Waiting for first sync',
      message:
        'Your device is paired. Keep Chrome open while the extension sends its first snapshot.',
    };
  const verified = Date.parse(device.lastVerifiedAt ?? '');
  if (
    !Number.isFinite(verified) ||
    now - verified > 5 * 60_000 ||
    verified - now > 60_000
  )
    return {
      kind: 'stale',
      label: 'Connection uncertain',
      message:
        'No recent verification from Chrome. These are the last saved tabs; the computer may be asleep or unable to connect.',
    };
  return {
    kind: 'fresh',
    label: 'Verified recently',
    message:
      'The extension recently verified these tabs. Changes appear after the next successful sync.',
  };
}
