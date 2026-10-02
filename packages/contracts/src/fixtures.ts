import mixedJson from '../examples/mixed.json';
import emptyJson from '../examples/empty.json';
import { validateSnapshot, type Snapshot } from './index';
export const fixtureNames = ['mixed', 'empty', 'large'] as const;
export type FixtureName = (typeof fixtureNames)[number];
export function makeFixture(name: FixtureName): Snapshot {
  if (name !== 'large')
    return validateSnapshot(
      structuredClone(name === 'mixed' ? mixedJson : emptyJson),
    );
  const windows = Array.from({ length: 20 }, (_, w) => ({
    id: w + 1,
    focused: w === 0,
    groups: Array.from({ length: 5 }, (_, g) => ({
      id: w * 5 + g,
      title: `Learning collection ${w * 5 + g + 1}`,
      color: 'blue' as const,
      collapsed: false,
    })),
    tabs: Array.from({ length: 50 }, (_, t) => ({
      id: w * 50 + t,
      index: t,
      groupId: w * 5 + Math.floor(t / 10),
      title: `Research article ${w * 50 + t + 1} — notes & ideas`,
      url: `https://example.com/reading/${w * 50 + t + 1}`,
      pinned: false,
    })),
  }));
  return validateSnapshot({
    ...emptyJson,
    revision: 43,
    omittedTabCount: 0,
    windows,
  });
}
