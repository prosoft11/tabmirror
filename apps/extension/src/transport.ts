declare const TABMIRROR_API_ORIGIN: string | undefined;
export const LOCAL_API =
  typeof TABMIRROR_API_ORIGIN === 'undefined'
    ? 'http://127.0.0.1:4319'
    : TABMIRROR_API_ORIGIN;
export class SyncError extends Error {
  constructor(
    message: string,
    public status = 0,
    public retryAfterMs = 0,
  ) {
    super(message);
  }
}
export interface Transport {
  status(token: string): Promise<number>;
  upload(
    token: string,
    body: string,
  ): Promise<{ revision: number; receivedAt: string }>;
  heartbeat(
    token: string,
    body: {
      revision: number;
      state: 'active' | 'paused';
      checkedAt?: string;
      deviceName: string;
    },
  ): Promise<void>;
  disconnect(token: string): Promise<void>;
}
export function httpTransport(fetcher: typeof fetch = fetch): Transport {
  async function request(
    token: string,
    path: string,
    method: string,
    body?: string,
  ) {
    let response: Response;
    try {
      response = await fetcher(`${LOCAL_API}/api/device/${path}`, {
        method,
        body,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        signal: AbortSignal.timeout(15_000),
        redirect: 'error',
        cache: 'no-store',
        credentials: 'omit',
      });
    } catch {
      throw new SyncError('Cannot reach TabMirror. Sync will retry.');
    }
    if (!response.ok) {
      const retry = response.headers.get('Retry-After');
      const delay = retry
        ? /^\d+$/.test(retry)
          ? Number(retry) * 1000
          : Math.max(0, Date.parse(retry) - Date.now())
        : 0;
      throw new SyncError(
        response.status === 401
          ? 'Connection expired or revoked. Reconnect with a valid token.'
          : response.status === 413
            ? 'Snapshot exceeds the upload limit. Last successful snapshot is unchanged.'
            : `Sync failed (HTTP ${response.status}).`,
        response.status,
        Number.isFinite(delay) ? Math.min(delay, 86_400_000) : 0,
      );
    }
    return response.status === 204 ? null : response.json();
  }
  return {
    async status(token) {
      const result = await request(token, 'status', 'GET');
      if (!Number.isSafeInteger(result?.revision) || result.revision < 0)
        throw new SyncError('Collector returned invalid status.');
      return result.revision as number;
    },
    async upload(token, body) {
      const result = await request(token, 'snapshot', 'PUT', body);
      if (
        !Number.isSafeInteger(result?.revision) ||
        typeof result.receivedAt !== 'string' ||
        !Number.isFinite(Date.parse(result.receivedAt))
      )
        throw new SyncError('Collector returned invalid acknowledgement.');
      return result as { revision: number; receivedAt: string };
    },
    async heartbeat(token, body) {
      await request(token, 'heartbeat', 'POST', JSON.stringify(body));
    },
    async disconnect(token) {
      await request(token, 'disconnect', 'POST');
    },
  };
}
