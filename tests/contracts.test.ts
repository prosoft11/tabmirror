import { describe, expect, it } from 'vitest';
import {
  ContractError,
  MAX_SNAPSHOT_BYTES,
  isEligibleUrl,
  parseSnapshot,
  validateSnapshot,
} from '@tabmirror/contracts';
import { makeFixture } from '../packages/contracts/src/fixtures';
describe('snapshot contract', () => {
  it.each(['mixed', 'empty', 'large'] as const)(
    'accepts %s fixture',
    (name) => {
      const data = makeFixture(name);
      expect(parseSnapshot(JSON.stringify(data))).toEqual(data);
    },
  );
  it('supports the aggregate boundary', () => {
    const value = makeFixture('large');
    expect(value.windows).toHaveLength(20);
    expect(value.windows.flatMap((w) => w.tabs)).toHaveLength(1000);
    expect(value.windows.flatMap((w) => w.groups)).toHaveLength(100);
  });
  it.each([
    [
      'duplicate tab',
      (s: ReturnType<typeof makeFixture>) => {
        s.windows[1]!.tabs[0]!.id = s.windows[0]!.tabs[0]!.id;
      },
    ],
    [
      'missing group',
      (s: ReturnType<typeof makeFixture>) => {
        s.windows[0]!.tabs[1]!.groupId = 999;
      },
    ],
    [
      'duplicate index',
      (s: ReturnType<typeof makeFixture>) => {
        s.windows[0]!.tabs[1]!.index = 0;
      },
    ],
    [
      'unordered windows',
      (s: ReturnType<typeof makeFixture>) => {
        s.windows.reverse();
      },
    ],
    [
      'two focused windows',
      (s: ReturnType<typeof makeFixture>) => {
        s.windows[1]!.focused = true;
      },
    ],
    [
      'noncontiguous group',
      (s: ReturnType<typeof makeFixture>) => {
        s.windows[0]!.tabs[0]!.groupId = 7;
        s.windows[0]!.tabs[1]!.groupId = null;
      },
    ],
    [
      'unrepresented group',
      (s: ReturnType<typeof makeFixture>) => {
        s.windows[0]!.groups.push({
          id: 99,
          title: '',
          color: 'blue',
          collapsed: false,
        });
      },
    ],
    [
      'invalid calendar day',
      (s: ReturnType<typeof makeFixture>) => {
        s.capturedAt = '2026-02-30T12:00:00Z';
      },
    ],
    [
      'unsafe integer',
      (s: ReturnType<typeof makeFixture>) => {
        s.revision = Number.MAX_SAFE_INTEGER + 1;
      },
    ],
  ] as const)('rejects %s', (_, mutate) => {
    const data = makeFixture('mixed');
    mutate(data);
    expect(() => validateSnapshot(data)).toThrow(ContractError);
  });
  it('rejects totals exceeding tab and group limits across windows', () => {
    const tabs = makeFixture('large');
    tabs.windows[0]!.tabs.push({
      id: 5000,
      index: 50,
      groupId: null,
      title: '',
      url: 'https://example.com/',
      pinned: false,
    });
    expect(() => validateSnapshot(tabs)).toThrow('limits');
    const groups = makeFixture('large');
    groups.windows[0]!.groups.push({
      id: 999,
      title: '',
      color: 'blue',
      collapsed: false,
    });
    groups.windows[0]!.tabs[49]!.groupId = 999;
    expect(() => validateSnapshot(groups)).toThrow('limits');
  });
  it.each([
    '{"x":1,"x":2}',
    '{"x":1,"\\u0078":2}',
    '{"nested":{"a":1,"a":2}}',
    '{/* comment */}',
    '{"x":1,}',
    '[] trailing',
  ])('rejects malformed/ambiguous JSON %s', (raw) => {
    expect(() => parseSnapshot(raw)).toThrow(ContractError);
  });
  it('limits nesting before parsing recursively', () => {
    expect(() =>
      parseSnapshot('['.repeat(100) + '0' + ']'.repeat(100)),
    ).toThrow('nesting');
  });
  it.each(['1.00000000000000001', '9e0', '9007199254740990.5'])(
    'rejects ambiguous numeric literal %s',
    (literal) => {
      const raw = JSON.stringify(makeFixture('empty')).replace(
        '\"revision\":42',
        `\"revision\":${literal}`,
      );
      expect(() => parseSnapshot(raw)).toThrow(ContractError);
    },
  );
  it('rejects unexpected private fields', () => {
    expect(() =>
      validateSnapshot({ ...makeFixture('mixed'), ownerId: 'forged' }),
    ).toThrow(ContractError);
  });
  it('counts UTF-8 bytes, including whitespace, before parsing', () => {
    expect(() => parseSnapshot(' '.repeat(MAX_SNAPSHOT_BYTES) + '{}')).toThrow(
      'limits',
    );
    expect(() => parseSnapshot('é'.repeat(MAX_SNAPSHOT_BYTES / 2 + 1))).toThrow(
      'limits',
    );
  });
  it.each([
    'javascript:alert(1)',
    'file:///tmp/a',
    'https://name:secret@example.com/',
    'https://example.com/\\bad',
    'https://example.com/ white',
    'https://',
    'https:///example.com/',
    'https://example.com/\n',
  ])('rejects unsafe URL %s', (url) => {
    expect(isEligibleUrl(url)).toBe(false);
  });
  it('preserves meaningful query and fragment', () => {
    const url = 'https://example.com/learn?lesson=3#part-2';
    expect(isEligibleUrl(url)).toBe(true);
  });
});
