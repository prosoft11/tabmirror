import { visit } from 'jsonc-parser';
import validateStructure from '../generated/validate.js';
import type { Snapshot } from '../generated/snapshot';
export type { Snapshot } from '../generated/snapshot';
export type SnapshotWindow = Snapshot['windows'][number];
export type SnapshotTab = SnapshotWindow['tabs'][number];
export const MAX_SNAPSHOT_BYTES = 2_097_152;
export const AUTOMATIC_SYNC_INTERVAL_MS = 120_000;
export class ContractError extends Error {
  constructor(
    public readonly code: 'INVALID_SNAPSHOT' | 'SNAPSHOT_TOO_LARGE',
    message: string,
  ) {
    super(message);
    this.name = 'ContractError';
  }
}
function invalid(message: string): never {
  throw new ContractError('INVALID_SNAPSHOT', message);
}
function tooLarge(): never {
  throw new ContractError(
    'SNAPSHOT_TOO_LARGE',
    'Snapshot exceeds supported limits.',
  );
}
export function isEligibleUrl(value: string): boolean {
  if (
    !/^https?:\/\/[^/?#]/.test(value) ||
    /[\s\u0000-\u001f\u007f\\]/u.test(value)
  )
    return false;
  try {
    const url = new URL(value);
    return !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}
/** Reject duplicate decoded keys, comments, trailing commas, and excessive nesting. */
export function parseStrictJson(text: string): unknown {
  const keys: Set<string>[] = [];
  let depth = 0;
  const enter = () => {
    if (++depth > 32) invalid('JSON nesting is too deep.');
  };
  visit(
    text,
    {
      onObjectBegin() {
        enter();
        keys.push(new Set());
      },
      onObjectProperty(key) {
        const current = keys.at(-1)!;
        if (current.has(key)) invalid('Duplicate JSON property.');
        current.add(key);
      },
      onLiteralValue(value, offset, length) {
        if (
          typeof value === 'number' &&
          (!Number.isSafeInteger(value) ||
            !/^-?\d+$/.test(text.slice(offset, offset + length)))
        )
          invalid('Snapshot numbers must be safe integer literals.');
      },
      onObjectEnd() {
        keys.pop();
        depth--;
      },
      onArrayBegin: enter,
      onArrayEnd() {
        depth--;
      },
      onError() {
        invalid('Invalid JSON.');
      },
    },
    {
      disallowComments: true,
      allowTrailingComma: false,
      allowEmptyContent: false,
    },
  );
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return invalid('Invalid JSON.');
  }
}
export function parseSnapshot(text: string): Snapshot {
  if (new TextEncoder().encode(text).byteLength > MAX_SNAPSHOT_BYTES)
    tooLarge();
  const value = parseStrictJson(text);
  return validateSnapshot(value);
}
export function validateSnapshot(value: unknown): Snapshot {
  if (!validateStructure(value)) {
    if (
      validateStructure.errors?.some((error) =>
        ['maxItems', 'maxLength'].includes(error.keyword),
      )
    )
      tooLarge();
    invalid('Snapshot does not match schema v1.');
  }
  const snapshot = value as Snapshot;
  if (
    new TextEncoder().encode(JSON.stringify(snapshot)).byteLength >
    MAX_SNAPSHOT_BYTES
  )
    tooLarge();
  // AJV asserts RFC3339 calendar validity; forbid non-finite JS dates, including leap-second normalization.
  if (!Number.isFinite(Date.parse(snapshot.capturedAt)))
    invalid('Invalid capture time.');
  let tabCount = 0,
    groupCount = 0,
    focusedCount = 0,
    previousWindow = -1;
  const tabIds = new Set<number>(),
    groupIds = new Set<number>();
  for (const window of snapshot.windows) {
    if (window.id <= previousWindow)
      invalid('Window IDs must be unique and ascending.');
    previousWindow = window.id;
    if (window.focused && ++focusedCount > 1)
      invalid('Only one window can be focused.');
    tabCount += window.tabs.length;
    groupCount += window.groups.length;
    if (tabCount > 1000 || groupCount > 100) tooLarge();
    const localGroups = new Set<number>();
    for (const group of window.groups) {
      if (groupIds.has(group.id)) invalid('Group IDs must be unique.');
      groupIds.add(group.id);
      localGroups.add(group.id);
    }
    let previousIndex = -1,
      previousGroup: number | null = null;
    const encountered: number[] = [];
    for (const tab of window.tabs) {
      if (tabIds.has(tab.id)) invalid('Tab IDs must be unique.');
      tabIds.add(tab.id);
      if (tab.index <= previousIndex)
        invalid('Tab indices must be unique and ascending.');
      previousIndex = tab.index;
      if (!isEligibleUrl(tab.url)) invalid('Tab URL is not eligible.');
      if (tab.groupId !== null) {
        if (!localGroups.has(tab.groupId))
          invalid('Tab group reference is missing.');
        if (tab.groupId !== previousGroup) {
          if (encountered.includes(tab.groupId))
            invalid('Group tabs must be contiguous.');
          encountered.push(tab.groupId);
        }
      }
      previousGroup = tab.groupId;
    }
    if (
      encountered.length !== window.groups.length ||
      encountered.some((id, i) => window.groups[i]?.id !== id)
    )
      invalid('Groups must be represented and ordered by first tab.');
  }
  return snapshot;
}
export interface SnapshotEnvelope {
  device: { id: string; name: string; status: 'active' | 'paused' | 'revoked' };
  receivedAt: string | null;
  lastContactAt: string | null;
  lastVerifiedAt: string | null;
  snapshot: Snapshot;
}
