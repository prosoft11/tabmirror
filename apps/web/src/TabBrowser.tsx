import { useEffect, useMemo, useState } from 'react';
import { validateSnapshot, type SnapshotTab } from '@tabmirror/contracts';
import {
  age,
  freshness,
  safeLink,
  tabRuns,
  type Device,
  type Envelope,
} from './tab-model';
export type Request = (
  path: string,
  method?: string,
  value?: unknown,
  signal?: AbortSignal,
) => Promise<any>;
const countLabel = (count: number, label: string) =>
  `${count} ${label}${count === 1 ? '' : 's'}`;
export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}
function Time({
  label,
  value,
  now,
}: {
  label: string;
  value: string | null;
  now: number;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {value && Number.isFinite(Date.parse(value)) ? (
          <>
            <span>{age(value, now)}</span>
            <time dateTime={value}>{new Date(value).toLocaleString()}</time>
          </>
        ) : (
          'Not yet'
        )}
      </dd>
    </div>
  );
}
function TabLink({ tab }: { tab: SnapshotTab }) {
  const href = safeLink(tab.url);
  return (
    <li className="saved-tab">
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          referrerPolicy="no-referrer"
        >
          <span className="local-tab-icon" aria-hidden="true">
            ↗
          </span>
          <span className="tab-copy">
            <span className="saved-title">
              {tab.title || 'Untitled tab'}
              {tab.pinned && <span className="pinned-label">Pinned</span>}
            </span>
            <span className="saved-url">{tab.url}</span>
          </span>
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      ) : (
        <span>Unsupported link</span>
      )}
    </li>
  );
}
export function TabBrowser({
  devices,
  request,
  refreshVersion,
  onManage,
}: {
  devices: Device[];
  request: Request;
  refreshVersion: number;
  onManage: () => void;
}) {
  const [selected, setSelected] = useState('');
  const device =
    devices.find((item) => item.id === selected) ??
    devices.find((item) => item.status !== 'revoked') ??
    devices[0];
  if (!device)
    return (
      <section className="browser-empty">
        <span aria-hidden="true">↗</span>
        <h2>Your desktop, ready to pick up.</h2>
        <p>
          Pair the Chrome extension to bring your open tabs here, organized by
          window and group.
        </p>
        <button className="primary" onClick={onManage}>
          Connect Chrome
        </button>
      </section>
    );
  return (
    <section className="tab-browser" aria-label="Saved Chrome tabs">
      <div className="device-picker">
        <label htmlFor="selected-device">Computer</label>
        <select
          id="selected-device"
          value={device.id}
          onChange={(event) => setSelected(event.target.value)}
        >
          {devices.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
              {item.status === 'revoked' ? ' · revoked' : ''}
            </option>
          ))}
        </select>
      </div>
      <DeviceTabs
        key={device.id}
        device={device}
        request={request}
        refreshVersion={refreshVersion}
      />
    </section>
  );
}
function DeviceTabs({
  device,
  request,
  refreshVersion,
}: {
  device: Device;
  request: Request;
  refreshVersion: number;
}) {
  const [record, setRecord] = useState<Envelope | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const [retry, setRetry] = useState(0),
    [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') setNow(Date.now());
    }, 15_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    request(
      `/api/devices/${device.id}/snapshot`,
      'GET',
      undefined,
      controller.signal,
    )
      .then((value: Envelope) => {
        if (value.device.id !== device.id)
          throw new Error('Unexpected device response.');
        if (value.snapshot !== null)
          value.snapshot = validateSnapshot(value.snapshot);
        if (!controller.signal.aborted) setRecord(value);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setError(
            error instanceof Error ? error.message : 'Unable to load tabs.',
          );
          if (error?.status === 404) setRecord(null);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [device.id, device.revision, request, refreshVersion, retry]);
  useEffect(() => {
    if (!error) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible')
        setRetry((value) => value + 1);
    }, 30_000);
    return () => clearInterval(timer);
  }, [error]);
  const snapshot = record?.snapshot;
  const windows = useMemo(
    () =>
      snapshot?.windows
        .map((window, index) => ({
          window,
          index,
          runs: tabRuns(window, query),
        }))
        .filter((value) => value.runs.length) ?? [],
    [snapshot, query],
  );
  const total =
    snapshot?.windows.reduce((sum, window) => sum + window.tabs.length, 0) ?? 0;
  const matched = windows.reduce(
    (sum, window) =>
      sum + window.runs.reduce((count, run) => count + run.tabs.length, 0),
    0,
  );
  const searching = !!query.trim();
  const outdated =
    record?.snapshot && record.snapshot.revision !== device.revision;
  const info = outdated
    ? {
        kind: 'stale',
        label: 'Newer snapshot available',
        message:
          'Showing the previously loaded tabs while the latest snapshot is retrieved.',
      }
    : freshness(device, now);
  const prefix = snapshot?.browserSessionId ?? '';
  const windowKey = (id: number) => `${prefix}:window:${id}`;
  const groupKey = (id: number) => `${prefix}:group:${id}`;
  function all(open: boolean) {
    const values: Record<string, boolean> = {};
    for (const window of snapshot?.windows ?? []) {
      values[windowKey(window.id)] = open;
      for (const group of window.groups) values[groupKey(group.id)] = open;
    }
    setExpanded(values);
  }
  function toggle(key: string, current: boolean) {
    setExpanded((previous) => ({ ...previous, [key]: !current }));
  }
  return (
    <>
      <div className={`freshness freshness-${info.kind}`}>
        <span className="freshness-dot" aria-hidden="true" />
        <div>
          <strong>{info.label}</strong>
          <p>{info.message}</p>
        </div>
        {info.kind === 'pending' && <Spinner />}
      </div>
      {error && (
        <div role="alert" className="account-error">
          <p>
            {error}{' '}
            {record ? 'Showing the last successfully loaded snapshot.' : ''}
          </p>
          <button onClick={() => setRetry((value) => value + 1)}>
            Retry loading tabs
          </button>
        </div>
      )}
      {loading && (
        <p role="status" className="loading-line">
          <Spinner />
          {record ? 'Updating saved tabs…' : 'Loading your tabs…'}
        </p>
      )}
      {snapshot && (
        <>
          <div className="search-bar">
            <label htmlFor="tab-search">Search your tabs</label>
            <div className="search-input">
              <span aria-hidden="true">⌕</span>
              <input
                id="tab-search"
                type="search"
                placeholder="Title, URL, or group name"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                autoComplete="off"
              />
              <button disabled={!query} onClick={() => setQuery('')}>
                Clear search
              </button>
            </div>
          </div>
          <div className="browser-toolbar">
            <p role="status">
              {searching
                ? `${matched} of ${total} tabs match`
                : `${countLabel(total, 'tab')} · ${countLabel(snapshot.windows.length, 'window')} · ${countLabel(
                    snapshot.windows.reduce(
                      (sum, w) => sum + w.groups.length,
                      0,
                    ),
                    'group',
                  )}`}
            </p>
            <div>
              <button disabled={searching || !total} onClick={() => all(true)}>
                Expand all
              </button>
              <button disabled={searching || !total} onClick={() => all(false)}>
                Collapse all
              </button>
            </div>
          </div>
          {searching && (
            <p className="search-note">
              Matching windows and groups are expanded. Clear search to restore
              your view.
            </p>
          )}
          {total === 0 ? (
            <div className="browser-empty">
              <h2>No open web tabs</h2>
              <p>
                The latest snapshot is empty. Open an HTTP or HTTPS page in
                desktop Chrome to see it here.
              </p>
            </div>
          ) : matched === 0 ? (
            <div className="browser-empty">
              <h2>No matching tabs</h2>
              <p>Try a different title, address, or group name.</p>
              <button onClick={() => setQuery('')}>Show all tabs</button>
            </div>
          ) : (
            <div className="saved-windows">
              {windows.map(({ window, index, runs }) => {
                const key = windowKey(window.id),
                  open = searching || (expanded[key] ?? true);
                const panel = `window-${window.id}`;
                return (
                  <section className="saved-window" key={key}>
                    <h2>
                      <button
                        className="disclosure"
                        aria-expanded={open}
                        aria-controls={panel}
                        disabled={searching}
                        onClick={() => toggle(key, open)}
                      >
                        <span aria-hidden="true">{open ? '⌄' : '›'}</span>
                        <span>
                          Window {index + 1}
                          {window.focused && <small>Last focused</small>}
                        </span>
                        <span className="disclosure-count">
                          {countLabel(
                            runs.reduce((n, r) => n + r.tabs.length, 0),
                            'tab',
                          )}
                        </span>
                      </button>
                    </h2>
                    <div
                      id={panel}
                      hidden={!open}
                      className="saved-window-body"
                    >
                      {runs.map((run) => {
                        const group = run.group,
                          groupId = group ? groupKey(group.id) : run.key,
                          groupOpen =
                            !group ||
                            searching ||
                            (expanded[groupId] ?? !group.collapsed);
                        return (
                          <section className="saved-group" key={run.key}>
                            {group ? (
                              <h3>
                                <button
                                  className="disclosure group-disclosure"
                                  aria-expanded={groupOpen}
                                  aria-controls={`group-${group.id}`}
                                  disabled={searching}
                                  onClick={() => toggle(groupId, groupOpen)}
                                >
                                  <span
                                    className={`group-dot color-${group.color}`}
                                    aria-hidden="true"
                                  />
                                  <span>{group.title || 'Untitled group'}</span>
                                  <span className="disclosure-count">
                                    {run.tabs.length}
                                  </span>
                                  <span aria-hidden="true">
                                    {groupOpen ? '⌄' : '›'}
                                  </span>
                                </button>
                              </h3>
                            ) : (
                              <h3 className="ungrouped-label">
                                Ungrouped tabs
                              </h3>
                            )}
                            <ul
                              id={group ? `group-${group.id}` : undefined}
                              hidden={!groupOpen}
                            >
                              {run.tabs.map((tab) => (
                                <TabLink key={tab.id} tab={tab} />
                              ))}
                            </ul>
                          </section>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
          {snapshot.omittedTabCount > 0 && (
            <p className="browser-footnote">
              {snapshot.omittedTabCount} unsupported or unavailable tabs
              omitted. Incognito tabs are never included.
            </p>
          )}
        </>
      )}
      {!loading && record?.snapshot === null && (
        <div className="browser-empty">
          <Spinner />
          <h2>Connected. Waiting for tabs.</h2>
          <p>
            The extension will send the first snapshot automatically. You can
            also choose “Sync now” in Chrome.
          </p>
        </div>
      )}
      <details className="sync-times">
        <summary>Sync details</summary>
        <dl>
          <Time
            label="Last verified by Chrome"
            value={device.lastVerifiedAt}
            now={now}
          />
          <Time label="Last contact" value={device.lastContactAt} now={now} />
          <Time
            label="Snapshot received"
            value={record?.receivedAt ?? device.receivedAt}
            now={now}
          />
          <Time
            label="Last content change"
            value={record?.lastContentChangedAt ?? device.lastContentChangedAt}
            now={now}
          />
        </dl>
      </details>
      <p className="browser-footnote">
        Chrome syncs and this page refreshes every 2 minutes while active.
        Changes may take up to 4 minutes to appear. Refresh retrieves the latest
        saved snapshot. It cannot wake a sleeping computer or change your
        desktop tabs. Links open in a new tab.
      </p>
    </>
  );
}
