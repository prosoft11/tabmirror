import { PrivateApp } from './PrivateApp';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  validateSnapshot,
  type Snapshot,
  type SnapshotTab,
  type SnapshotWindow,
} from '@tabmirror/contracts';
import './style.css';
function tabRuns(window: SnapshotWindow) {
  const runs: { groupId: number | null; tabs: SnapshotTab[] }[] = [];
  for (const tab of window.tabs) {
    const last = runs.at(-1);
    if (last && last.groupId === tab.groupId) last.tabs.push(tab);
    else runs.push({ groupId: tab.groupId, tabs: [tab] });
  }
  return runs;
}
function FixtureApp() {
  const [fixture, setFixture] = useState('mixed');
  const [refresh, setRefresh] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setSnapshot(null);
    async function load() {
      try {
        const response = await fetch(`/api/devices/${fixture}/snapshot`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok)
          throw new Error(
            'The local API could not load this preview. Check that both development servers are running.',
          );
        const value = (await response.json()) as { snapshot: unknown };
        const validated = validateSnapshot(value.snapshot);
        if (!controller.signal.aborted) setSnapshot(validated);
      } catch (err) {
        if (!controller.signal.aborted)
          setError(
            err instanceof Error ? err.message : 'Unable to load preview.',
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [fixture, refresh]);
  const tabCount =
    snapshot?.windows.reduce(
      (count, window) => count + window.tabs.length,
      0,
    ) ?? 0;
  const groupCount =
    snapshot?.windows.reduce(
      (count, window) => count + window.groups.length,
      0,
    ) ?? 0;
  return (
    <>
      <header className="topbar">
        <a className="brand" href="/" aria-label="TabMirror home">
          <span className="brand-icon" aria-hidden="true">
            ▥
          </span>
          TabMirror<span className="version">LOCAL</span>
        </a>
        <span className="top-note">Your tabs, in perspective.</span>
      </header>
      <main>
        <div className="eyebrow">
          <span className="dot" /> DEVELOPMENT PREVIEW
        </div>
        <h1>
          A little more space
          <br />
          for everything open.
        </h1>
        <p className="intro">
          Your desktop’s organization, ready for a smaller screen.
        </p>
        <aside className="notice">
          <strong>Synthetic data only</strong>
          <span>
            This local preview uses example tabs. Chrome capture, Google login,
            and cloud sync arrive in later phases.
          </span>
        </aside>
        <section className="workspace" aria-label="Tab preview">
          <div className="workspace-header">
            <div>
              <p className="eyebrow">EXAMPLE DEVICE</p>
              <h2>Example MacBook</h2>
            </div>
            <span className="fixture-badge">Fixture · not live</span>
          </div>
          <div className="toolbar">
            <label htmlFor="fixture">
              Preview collection
              <select
                id="fixture"
                value={fixture}
                onChange={(event) => setFixture(event.target.value)}
              >
                <option value="mixed">Everyday collection</option>
                <option value="empty">Empty collection</option>
                <option value="large">Large collection · 1,000 tabs</option>
              </select>
            </label>
            <button
              onClick={() => setRefresh((value) => value + 1)}
              disabled={loading}
            >
              Reload preview
            </button>
          </div>
          <div aria-live="polite" className="summary">
            {loading
              ? 'Loading collection…'
              : error
                ? 'Preview unavailable'
                : `${tabCount.toLocaleString()} tabs · ${snapshot?.windows.length ?? 0} windows · ${groupCount} groups`}
          </div>
          {error && (
            <div role="alert" className="empty">
              <h3>Let’s reconnect.</h3>
              <p>{error}</p>
              <button onClick={() => setRefresh((value) => value + 1)}>
                Try again
              </button>
            </div>
          )}
          {!loading && !error && snapshot?.windows.length === 0 && (
            <div className="empty">
              <span aria-hidden="true">▱</span>
              <h3>A clear desk.</h3>
              <p>This collection has no eligible open tabs.</p>
            </div>
          )}
          {!loading &&
            !error &&
            snapshot?.windows.map((window, index) => (
              <details
                className="window"
                key={`${fixture}-${window.id}`}
                open={index === 0}
              >
                <summary>
                  <span>Window {index + 1}</span>
                  <span className="count">{window.tabs.length} tabs</span>
                </summary>
                <div className="window-content">
                  {tabRuns(window).map((run, runIndex) => {
                    const group = window.groups.find(
                      (entry) => entry.id === run.groupId,
                    );
                    return (
                      <section className="tab-group" key={runIndex}>
                        <h3>
                          <span
                            className={`group-dot color-${group?.color ?? 'grey'}`}
                            aria-hidden="true"
                          />
                          {group
                            ? group.title || 'Untitled group'
                            : 'Ungrouped'}
                          <span className="group-count">{run.tabs.length}</span>
                        </h3>
                        <ul>
                          {run.tabs.map((tab) => (
                            <li key={tab.id}>
                              <span className="tab-icon" aria-hidden="true">
                                {tab.pinned ? '◇' : '▤'}
                              </span>
                              <a
                                href={tab.url}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <span className="tab-title">
                                  {tab.title || new URL(tab.url).hostname}
                                </span>
                                <span className="tab-host">
                                  {new URL(tab.url).hostname}
                                </span>
                              </a>
                              <span className="arrow" aria-hidden="true">
                                ↗
                              </span>
                            </li>
                          ))}
                        </ul>
                      </section>
                    );
                  })}
                </div>
              </details>
            ))}
          {!loading && !error && snapshot && (
            <footer className="collection-footer">
              {snapshot.omittedTabCount} unsupported{' '}
              {snapshot.omittedTabCount === 1 ? 'tab' : 'tabs'} omitted in this
              example<span>Validated snapshot · v{snapshot.schemaVersion}</span>
            </footer>
          )}
        </section>
        <p className="footnote">
          A private mirror of what’s already open. Nothing more to organize.
        </p>
      </main>
    </>
  );
}
function App() {
  const [mode, setMode] = useState<'loading' | 'fixture' | 'private' | 'error'>(
    'loading',
  );
  useEffect(() => {
    let active = true;
    fetch('/api/session', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Session unavailable');
        const session = await response.json();
        if (active)
          setMode(session.mode === 'local-mock' ? 'fixture' : 'private');
      })
      .catch(() => {
        if (active) setMode('error');
      });
    return () => {
      active = false;
    };
  }, []);
  return mode === 'fixture' ? (
    <FixtureApp />
  ) : mode === 'private' ? (
    <PrivateApp />
  ) : (
    <main>
      <p role="status">
        {mode === 'error'
          ? 'TabMirror is unavailable. Please reload.'
          : 'Loading TabMirror…'}
      </p>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {import.meta.env.VITE_PRODUCTION_PRIVATE ? <PrivateApp /> : <App />}
  </StrictMode>,
);
