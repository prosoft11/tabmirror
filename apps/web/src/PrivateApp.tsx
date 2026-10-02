import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { TabBrowser, Spinner } from './TabBrowser';
import type { Device } from './tab-model';
import './mobile.css';
import { AUTOMATIC_SYNC_INTERVAL_MS } from '@tabmirror/contracts';
interface Session {
  authenticated: boolean;
  email?: string;
  csrfToken?: string;
  googleConfigured?: boolean;
}
interface Pairing {
  id: string;
  code: string;
  name: string;
  expiresAt: number;
}
export function PrivateApp() {
  const generation = useRef(0);
  const sessionRef = useRef<Session | null>(null);
  const refreshWork = useRef<Promise<void> | null>(null);
  const actionBusy = useRef(false);
  const [session, setSession] = useState<Session | null>(null);
  sessionRef.current = session;
  const [devices, setDevices] = useState<Device[]>([]);
  const [code, setCode] = useState('');
  const [pair, setPair] = useState<Pairing | null>(null);
  const [waiting, setWaiting] = useState<{
    name: string;
    expiresAt: number;
    before: string[];
    stage: 'connecting' | 'syncing' | 'ready' | 'expired';
  } | null>(null);
  const [view, setView] = useState<'tabs' | 'account'>(
    location.pathname === '/pair' ? 'account' : 'tabs',
  );
  const [pageActive, setPageActive] = useState(true);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(
    location.search.includes('auth=failed')
      ? 'Sign-in could not be verified. Use an approved Google account and try again.'
      : '',
  );
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const clearPrivate = useCallback(() => {
    generation.current++;
    setSession({ authenticated: false, googleConfigured: true });
    setDevices([]);
    setPair(null);
    setWaiting(null);
    setCode('');
  }, []);
  const request = useCallback(
    async (
      path: string,
      method = 'GET',
      value?: unknown,
      signal?: AbortSignal,
    ) => {
      const response = await fetch(path, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
          : AbortSignal.timeout(15_000),
        headers: {
          'Content-Type': 'application/json',
          ...(sessionRef.current?.csrfToken
            ? { 'X-CSRF-Token': sessionRef.current.csrfToken }
            : {}),
        },
        body: value === undefined ? undefined : JSON.stringify(value),
      });
      if (response.status === 401) clearPrivate();
      const result = response.status === 204 ? null : await response.json();
      if (!response.ok)
        throw Object.assign(
          new Error(result?.error?.message ?? 'Request failed. Please retry.'),
          { status: response.status },
        );
      return result;
    },
    [clearPrivate],
  );
  const refresh = useCallback(async () => {
    if (refreshWork.current) return refreshWork.current;
    const current = generation.current;
    const work = (async () => {
      setRefreshing(true);
      try {
        const next = await request('/api/session');
        const nextDevices = next.authenticated
          ? ((await request('/api/devices')).devices as Device[])
          : [];
        if (current !== generation.current) return;
        setSession(next);
        setDevices(nextDevices);
        setPageActive(true);
        setError('');
        if (!next.authenticated) {
          setPair(null);
          setWaiting(null);
        } else
          setWaiting((previous) => {
            if (
              !previous ||
              previous.stage === 'ready' ||
              previous.stage === 'expired'
            )
              return previous;
            const added = nextDevices.find(
              (device) =>
                !previous.before.includes(device.id) &&
                device.status !== 'revoked',
            );
            return {
              ...previous,
              name: added?.name ?? previous.name,
              stage: added?.revision
                ? 'ready'
                : Date.now() >= previous.expiresAt
                  ? 'expired'
                  : added
                    ? 'syncing'
                    : 'connecting',
            };
          });
      } catch (error) {
        if (current === generation.current)
          setError(
            error instanceof Error
              ? error.message
              : 'Unable to refresh. Your last saved view is still available.',
          );
      } finally {
        setRefreshing(false);
      }
    })();
    refreshWork.current = work;
    try {
      await work;
    } finally {
      if (refreshWork.current === work) refreshWork.current = null;
    }
  }, [request]);
  useEffect(() => {
    void refresh();
    const visible = () => {
      if (document.visibilityState === 'visible') {
        setRefreshVersion((value) => value + 1);
        void refresh();
      }
    };
    const hide = () => {
      generation.current++;
      flushSync(() => setPageActive(false));
    };
    const channel = new BroadcastChannel('tabmirror-session');
    channel.onmessage = (event) => {
      if (event.data === 'logout') clearPrivate();
    };
    window.addEventListener('pageshow', visible);
    window.addEventListener('pagehide', hide);
    document.addEventListener('visibilitychange', visible);
    return () => {
      generation.current++;
      refreshWork.current = null;
      channel.close();
      window.removeEventListener('pageshow', visible);
      window.removeEventListener('pagehide', hide);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [refresh, clearPrivate]);
  const connecting =
    waiting?.stage === 'connecting' || waiting?.stage === 'syncing';
  useEffect(() => {
    if (!session?.authenticated) return;
    const timer = setInterval(
      () => {
        if (document.visibilityState === 'visible' && !actionBusy.current) {
          setWaiting((previous) =>
            previous &&
            ['connecting', 'syncing'].includes(previous.stage) &&
            Date.now() >= previous.expiresAt
              ? { ...previous, stage: 'expired' }
              : previous,
          );
          void refresh();
        }
      },
      connecting ? 3000 : AUTOMATIC_SYNC_INTERVAL_MS,
    );
    return () => clearInterval(timer);
  }, [session?.authenticated, connecting, devices, refresh]);
  async function act(work: () => Promise<void>, label = 'Working…') {
    if (actionBusy.current) return;
    actionBusy.current = true;
    setBusy(label);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Action failed.');
    } finally {
      actionBusy.current = false;
      setBusy('');
    }
  }
  function navigate(next: 'tabs' | 'account') {
    setView(next);
    history.replaceState(null, '', next === 'tabs' ? '/' : '/pair');
  }
  return (
    <main className="account-page mobile-app">
      <header>
        <div className="brand-lockup">
          <img src="/tabmirror.png" width="44" height="44" alt="" />
          <p className="eyebrow">TABMIRROR · PRIVATE ACCESS</p>
        </div>
        <h1>
          {session?.authenticated && view === 'tabs'
            ? 'Pick up where you left off.'
            : 'Your tabs. Your account.'}
        </h1>
        <p className="page-intro">
          {session?.authenticated && view === 'tabs'
            ? 'Your open Chrome tabs, organized just as you left them.'
            : 'Connect your desktop Chrome extension to your private account.'}
        </p>
      </header>
      {session?.authenticated && (
        <nav className="app-nav" aria-label="TabMirror">
          <button
            aria-current={view === 'tabs' ? 'page' : undefined}
            onClick={() => navigate('tabs')}
          >
            Your tabs
          </button>
          <button
            aria-current={view === 'account' ? 'page' : undefined}
            onClick={() => navigate('account')}
          >
            Account & devices
          </button>
          <button
            className="refresh-view"
            disabled={refreshing || !!busy}
            onClick={() => {
              setRefreshVersion((value) => value + 1);
              void refresh();
            }}
          >
            {refreshing ? (
              <>
                <Spinner />
                Refreshing…
              </>
            ) : (
              'Refresh'
            )}
          </button>
        </nav>
      )}
      {busy && (
        <p className="loading-line" role="status">
          <Spinner />
          {busy}
        </p>
      )}
      {waiting && (
        <div className={`pair-progress stage-${waiting.stage}`} role="status">
          {connecting ? (
            <Spinner />
          ) : (
            <span aria-hidden="true">
              {waiting.stage === 'ready' ? '✓' : '!'}
            </span>
          )}
          <div>
            <strong>
              {waiting.stage === 'ready'
                ? `${waiting.name} connected — tabs ready`
                : waiting.stage === 'expired'
                  ? 'Connection is taking longer than expected'
                  : waiting.stage === 'syncing'
                    ? `${waiting.name} connected. Waiting for first sync…`
                    : `Connecting ${waiting.name}…`}
            </strong>
            <p>
              {waiting.stage === 'ready'
                ? 'Your saved tabs are now available. No page refresh needed.'
                : waiting.stage === 'expired'
                  ? 'Check the extension for an error. If the code expired, start pairing again; if it connected, choose Sync now.'
                  : 'Keep desktop Chrome open. This page updates automatically as the extension connects.'}
            </p>
            {waiting.stage === 'ready' && (
              <button
                className="primary"
                onClick={() => {
                  navigate('tabs');
                  setWaiting(null);
                }}
              >
                View tabs
              </button>
            )}
            {waiting.stage === 'expired' && (
              <button
                onClick={() => {
                  setWaiting(null);
                  void refresh();
                }}
              >
                Check devices
              </button>
            )}
          </div>
        </div>
      )}
      {error && (
        <div role="alert" className="account-error">
          {error}
          <button onClick={() => void refresh()}>Retry</button>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {!pageActive || !session ? (
        <p role="status" className="loading-line">
          <Spinner />
          Checking your session…
        </p>
      ) : !session.authenticated ? (
        <section className="account-card">
          <h2>Sign in</h2>
          <p>Access is limited to the approved Daniel and Farris accounts.</p>
          <button
            disabled={!!busy || !session.googleConfigured}
            onClick={() =>
              void act(async () => {
                const result = await request('/api/auth/login', 'POST');
                location.assign(result.authorizationUrl);
              })
            }
          >
            Continue with Google
          </button>
          {!session.googleConfigured && (
            <p role="status">
              Google sign-in is awaiting OAuth client setup. No private data is
              accessible while setup is incomplete.
            </p>
          )}
        </section>
      ) : (
        <>
          {view === 'tabs' ? (
            <TabBrowser
              key={session.email}
              devices={devices}
              request={request}
              refreshVersion={refreshVersion}
              onManage={() => navigate('account')}
            />
          ) : (
            <>
              <section className="account-card">
                <h2>Signed in</h2>
                <p>{session.email}</p>
                <button
                  disabled={!!busy}
                  onClick={() =>
                    void act(async () => {
                      generation.current++;
                      await request('/api/auth/logout', 'POST');
                      clearPrivate();
                      const channel = new BroadcastChannel('tabmirror-session');
                      channel.postMessage('logout');
                      channel.close();
                    })
                  }
                >
                  Sign out
                </button>
              </section>
              <section className="account-card">
                <h2>Connect Chrome</h2>
                <p>
                  In the TabMirror extension, choose “Pair with my account”.
                  Enter its code here, then compare the device name and code
                  before approving.
                </p>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void act(async () =>
                      setPair(
                        await request('/api/pairings/lookup', 'POST', { code }),
                      ),
                    );
                  }}
                >
                  <label htmlFor="pair-code">Pairing code</label>
                  <input
                    id="pair-code"
                    value={code}
                    onChange={(event) => {
                      setCode(
                        event.target.value
                          .toUpperCase()
                          .replace(/[^A-Z0-9]/g, '')
                          .slice(0, 8),
                      );
                      setPair(null);
                    }}
                    autoComplete="off"
                    spellCheck={false}
                    minLength={8}
                    maxLength={8}
                    required
                  />
                  <button disabled={!!busy}>Review device</button>
                </form>
                {pair && (
                  <div className="pair-review">
                    <h3>Confirm this device</h3>
                    <p>
                      <strong>{pair.name}</strong>
                    </p>
                    <p>
                      Code: <strong>{pair.code}</strong>
                    </p>
                    <p>
                      This name is supplied by the extension. Approve only if
                      both match the extension you are connecting.
                    </p>
                    <button
                      disabled={!!busy}
                      onClick={() =>
                        void act(async () => {
                          await request('/api/pairings/approve', 'POST', {
                            id: pair.id,
                            code: pair.code,
                          });
                          setWaiting({
                            name: pair.name,
                            expiresAt: pair.expiresAt,
                            before: devices.map((device) => device.id),
                            stage: 'connecting',
                          });
                          setPair(null);
                          setCode('');
                          await refresh();
                        })
                      }
                    >
                      Approve connection
                    </button>
                    <button
                      disabled={!!busy}
                      onClick={() =>
                        void act(async () => {
                          await request('/api/pairings/deny', 'POST', {
                            id: pair.id,
                            code: pair.code,
                          });
                          setPair(null);
                          setCode('');
                          setNotice('Pairing denied.');
                        })
                      }
                    >
                      Deny
                    </button>
                  </div>
                )}
              </section>
              <section className="account-card">
                <h2>Your devices</h2>
                <button disabled={!!busy} onClick={() => void act(refresh)}>
                  Refresh devices
                </button>
                {devices.length === 0 ? (
                  <p>
                    {connecting
                      ? 'Your device will appear here automatically.'
                      : 'No paired devices yet.'}
                  </p>
                ) : (
                  devices.map((device) => (
                    <article key={device.id} className="device-row">
                      <h3>{device.name}</h3>
                      <p>
                        {device.status} ·{' '}
                        {device.revision
                          ? 'Tabs saved'
                          : 'Waiting for first sync'}
                      </p>
                      <button
                        disabled={!!busy || device.status === 'revoked'}
                        onClick={() =>
                          void act(async () => {
                            await request(
                              `/api/devices/${device.id}/revoke`,
                              'POST',
                            );
                            await refresh();
                          })
                        }
                      >
                        Revoke connection
                      </button>
                      <button
                        disabled={!!busy}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Delete ${device.name} and its saved snapshot? This cannot be undone.`,
                            )
                          )
                            void act(async () => {
                              await request(
                                `/api/devices/${device.id}`,
                                'DELETE',
                              );
                              await refresh();
                            });
                        }}
                      >
                        Delete device and data
                      </button>
                    </article>
                  ))
                )}
                <p>
                  Revoking stops new uploads and retains the last snapshot.
                  Delete removes the saved device data. Revoke the current
                  device before pairing a replacement.
                </p>
              </section>
              <p>
                Sessions renew during use, for up to 365 days of inactivity.
                Browser settings or clearing cookies may require signing in
                again.
              </p>
            </>
          )}
        </>
      )}
    </main>
  );
}
