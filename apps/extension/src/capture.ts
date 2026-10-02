import {
  isEligibleUrl,
  validateSnapshot,
  type Snapshot,
} from '@tabmirror/contracts';
export interface BrowserReader {
  windows(): Promise<chrome.windows.Window[]>;
  groups(): Promise<chrome.tabGroups.TabGroup[]>;
  generation(): number;
}
export async function capture(
  reader: BrowserReader,
  sessionId: string,
  revision: number,
  now: () => number,
): Promise<Snapshot> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = reader.generation();
    try {
      const windows = await reader.windows();
      const groups = await reader.groups();
      let omittedTabCount = 0;
      const output = windows
        .filter((w) => w.type === 'normal' && !w.incognito)
        .map((w) => {
          if (w.id === undefined || !w.tabs)
            throw new Error('Incomplete browser capture.');
          const tabs = w.tabs
            .filter((t) => {
              if (t.incognito) return false;
              if (!t.url || !isEligibleUrl(t.url)) {
                omittedTabCount++;
                return false;
              }
              return true;
            })
            .sort((a, b) => a.index - b.index)
            .map((t) => {
              if (t.id === undefined || t.windowId !== w.id)
                throw new Error('Tabs moved during capture.');
              return {
                id: t.id,
                index: t.index,
                groupId: t.groupId === -1 ? null : t.groupId,
                title: t.title ?? '',
                url: t.url!,
                pinned: t.pinned,
              };
            });
          const groupIds = [
            ...new Set(
              tabs.flatMap((t) => (t.groupId === null ? [] : [t.groupId])),
            ),
          ];
          return {
            id: w.id,
            focused: w.focused,
            tabs,
            groups: groupIds.map((id) => {
              const g = groups.find((g) => g.id === id && g.windowId === w.id);
              if (!g) throw new Error('Groups moved during capture.');
              return {
                id: g.id,
                title: g.title ?? '',
                color: g.color,
                collapsed: g.collapsed,
              };
            }),
          };
        })
        .filter((w) => w.tabs.length > 0)
        .sort((a, b) => a.id - b.id);
      // Focus is a hint, not an ordering or capture requirement. Chromium can
      // report multiple focused windows (notably in headless/transition states).
      if (output.filter((w) => w.focused).length > 1) {
        for (const window of output) window.focused = false;
      }
      if (reader.generation() !== before) continue;
      return validateSnapshot({
        schemaVersion: 1,
        browserSessionId: sessionId,
        revision,
        capturedAt: new Date(now()).toISOString(),
        omittedTabCount,
        windows: output,
      });
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
  throw new Error('Browser changed during capture. Try again shortly.');
}
