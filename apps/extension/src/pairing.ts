import { LOCAL_API } from './transport';
export interface PairingState {
  verifier: string;
  id: string;
  code: string;
  name: string;
  expiresAt: number;
  nextPoll: number;
  token?: string;
  error?: string;
}
export type PairingView = Omit<PairingState, 'verifier' | 'token'>;
interface Ports {
  load(): Promise<PairingState | undefined>;
  save(state: PairingState | undefined): Promise<void>;
  connect(token: string, name: string): Promise<void>;
  now(): number;
  fetch: typeof fetch;
}
export class PairingEngine {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private ports: Ports) {}
  private exclusive<T>(fn: () => Promise<T>) {
    const result = this.queue.then(fn);
    this.queue = result.catch(() => undefined);
    return result;
  }
  async view(): Promise<PairingView | undefined> {
    const state = await this.ports.load();
    if (!state) return undefined;
    const { verifier: _verifier, token: _token, ...view } = state;
    return view;
  }
  private async request(path: string, value: unknown) {
    const fetcher = this.ports.fetch;
    const response = await fetcher(`${LOCAL_API}/api/pairings/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const error = new Error(
        response.status === 410
          ? 'Pairing expired or was already used. Revoke any abandoned device on the site and start again.'
          : 'Pairing could not finish. Please retry.',
      );
      Object.assign(error, {
        status: response.status,
        retry: Number(response.headers.get('Retry-After') ?? 5) * 1000,
      });
      throw error;
    }
    return response.json();
  }
  start(name: string) {
    return this.exclusive(async () => {
      name = name.trim();
      if (!name || name.length > 80) throw new Error('Enter a device name.');
      const existing = await this.ports.load();
      if (existing && existing.expiresAt > this.ports.now() && !existing.error)
        return;
      const verifier = Array.from(
        crypto.getRandomValues(new Uint8Array(32)),
        (b) => b.toString(16).padStart(2, '0'),
      ).join('');
      const bytes = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(verifier),
      );
      const challenge = Array.from(new Uint8Array(bytes), (b) =>
        b.toString(16).padStart(2, '0'),
      ).join('');
      const result = await this.request('start', { challenge, name });
      if (
        !/^[a-f0-9-]{36}$/.test(result.id) ||
        !/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(result.code) ||
        !Number.isSafeInteger(result.expiresAt)
      )
        throw new Error('Invalid pairing response.');
      await this.ports.save({
        verifier,
        id: result.id,
        code: result.code,
        name,
        expiresAt: result.expiresAt,
        nextPoll: this.ports.now() + 5000,
      });
    });
  }
  poll() {
    return this.exclusive(async () => {
      const state = await this.ports.load();
      if (!state) return;
      if (state.error && !state.verifier && !state.token) return;
      if (!state.token && state.expiresAt <= this.ports.now()) {
        await this.ports.save(undefined);
        return;
      }
      if (state.nextPoll > this.ports.now()) return;
      // Persist before networking, so worker termination cannot bypass the polling interval.
      state.nextPoll = this.ports.now() + 5000;
      await this.ports.save(state);
      try {
        if (!state.token) {
          const result = await this.request('redeem', {
            id: state.id,
            verifier: state.verifier,
          });
          if (result.status === 'pending') return;
          if (
            result.status !== 'paired' ||
            !/^[a-f0-9]{64}$/.test(result.token)
          )
            throw new Error('Invalid pairing response.');
          state.token = result.token;
          state.verifier = '';
          state.error = undefined;
          await this.ports.save(state);
        }
        await this.ports.connect(state.token!, state.name);
        await this.ports.save(undefined);
      } catch (error) {
        const failure = error as Error & { status?: number; retry?: number };
        if ([400, 401, 403, 409, 410].includes(failure.status ?? 0)) {
          state.verifier = '';
          state.token = undefined;
          state.error = failure.message;
        } else {
          state.nextPoll =
            this.ports.now() +
            Math.max(5000, Math.min(failure.retry || 15_000, 600_000));
          state.error = 'Waiting for the API. Pairing will retry.';
        }
        await this.ports.save(state);
      }
    });
  }
  cancel() {
    return this.exclusive(() => this.ports.save(undefined));
  }
}
