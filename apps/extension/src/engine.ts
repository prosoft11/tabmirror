import { ContractError, type Snapshot } from '@tabmirror/contracts';
import { SyncError, type Transport } from './transport';
export interface State {
  token?: string;
  deviceName: string;
  paused: boolean;
  dirty: boolean;
  revision: number;
  ackRevision: number;
  ackHash?: string;
  lastSync?: string;
  lastCheck?: string;
  error?: string;
  failures: number;
  nextAttemptAt: number;
  automaticAfter?: number;
  blocked: boolean;
  tabCount: number;
  windowCount: number;
  omittedCount: number;
}
export const initialState = (): State => ({
  deviceName: 'My Mac',
  paused: false,
  dirty: true,
  revision: 0,
  ackRevision: 0,
  failures: 0,
  nextAttemptAt: 0,
  blocked: false,
  tabCount: 0,
  windowCount: 0,
  omittedCount: 0,
});
export interface EnginePorts {
  automaticIntervalMs?: number;
  load(): Promise<State | undefined>;
  save(state: State): Promise<void>;
  capture(revision: number): Promise<Snapshot>;
  transport: Transport;
  now(): number;
  random(): number;
  hash(value: string): Promise<string>;
}
export class SyncEngine {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private ports: EnginePorts) {}
  private exclusive<T>(work: (s: State) => Promise<T>): Promise<T> {
    const result = this.queue.then(async () =>
      work((await this.ports.load()) ?? initialState()),
    );
    this.queue = result.catch(() => undefined);
    return result;
  }
  status() {
    return this.exclusive(async (s) => {
      const { token, ...safe } = s;
      return { ...safe, connected: !!token };
    });
  }
  dirty() {
    return this.exclusive(async (s) => {
      s.dirty = true;
      await this.ports.save(s);
    });
  }
  connect(token: string, deviceName: string) {
    return this.exclusive(async (previous) => {
      if (!/^[a-f0-9]{64}$/.test(token))
        throw new Error('Enter a valid device token.');
      const name = deviceName.trim();
      if (!name || name.length > 80)
        throw new Error('Device name must be 1–80 characters.');
      // Do not erase an existing credential until the replacement has been verified.
      const revision = await this.ports.transport.status(token);
      const s = previous.token === token ? previous : initialState();
      Object.assign(s, {
        token,
        deviceName: name,
        revision: Math.max(s.revision, revision),
        blocked: false,
        error: undefined,
        paused: false,
        dirty: true,
        nextAttemptAt: 0,
      });
      await this.ports.save(s);
    });
  }
  rename(name: string) {
    return this.exclusive(async (s) => {
      const value = name.trim();
      if (!value || value.length > 80)
        throw new Error('Device name must be 1–80 characters.');
      s.deviceName = value;
      await this.ports.save(s);
    });
  }
  pause(paused: boolean) {
    return this.exclusive(async (s) => {
      s.paused = paused;
      s.nextAttemptAt = 0;
      s.dirty = true;
      await this.ports.save(s);
    });
  }
  disconnect() {
    return this.exclusive(async (s) => {
      let warning: string | undefined;
      try {
        if (s.token) await this.ports.transport.disconnect(s.token);
      } catch {
        warning =
          'Disconnected locally. Server revocation could not be confirmed; revoke this device on the TabMirror website.';
      }
      const next = initialState();
      next.deviceName = s.deviceName;
      next.error = warning;
      await this.ports.save(next);
    });
  }
  run(force = false) {
    return this.exclusive(async (s) => {
      if (
        !s.token ||
        s.blocked ||
        (!force &&
          Math.max(s.nextAttemptAt, s.automaticAfter ?? 0) > this.ports.now())
      )
        return;
      s.automaticAfter =
        this.ports.now() + (this.ports.automaticIntervalMs ?? 0);
      await this.ports.save(s);
      try {
        if (s.paused) {
          await this.ports.transport.heartbeat(s.token, {
            revision: s.ackRevision,
            state: 'paused',
            deviceName: s.deviceName,
          });
        } else {
          s.dirty = true;
          await this.ports.save(s);
          const remote = await this.ports.transport.status(s.token);
          s.revision = Math.max(s.revision, remote);
          if (s.revision >= Number.MAX_SAFE_INTEGER)
            throw new SyncError(
              'Revision limit reached. Reconnect to a new collector.',
              400,
            );
          const snapshot = await this.ports.capture(s.revision + 1);
          const hash = await this.ports.hash(
            JSON.stringify({
              browserSessionId: snapshot.browserSessionId,
              windows: snapshot.windows,
              omittedTabCount: snapshot.omittedTabCount,
            }),
          );
          if (hash !== s.ackHash || remote !== s.ackRevision) {
            s.revision = snapshot.revision;
            await this.ports.save(s); // reserve before the request, including uncertain/lost acknowledgements
            const ack = await this.ports.transport.upload(
              s.token,
              JSON.stringify(snapshot),
            );
            if (ack.revision !== snapshot.revision)
              throw new SyncError(
                'Collector acknowledged an unexpected revision.',
              );
            s.ackRevision = ack.revision;
            s.ackHash = hash;
            s.lastSync = ack.receivedAt;
          }
          await this.ports.transport.heartbeat(s.token, {
            revision: s.ackRevision,
            state: 'active',
            checkedAt: snapshot.capturedAt,
            deviceName: s.deviceName,
          });
          s.lastCheck = new Date(this.ports.now()).toISOString();
          s.dirty = false;
          s.tabCount = snapshot.windows.reduce((n, w) => n + w.tabs.length, 0);
          s.windowCount = snapshot.windows.length;
          s.omittedCount = snapshot.omittedTabCount;
        }
        s.error = undefined;
        s.failures = 0;
        s.nextAttemptAt = 0;
      } catch (error) {
        s.dirty = true;
        s.failures++;
        s.error =
          error instanceof ContractError
            ? 'Capture exceeds supported limits or is inconsistent. Last successful snapshot is unchanged.'
            : error instanceof SyncError
              ? error.message
              : 'Unable to capture a consistent browser snapshot. Sync will retry.';
        s.blocked =
          error instanceof SyncError &&
          [400, 401, 403, 404, 405].includes(error.status);
        const backoff = Math.min(
          300_000,
          5_000 * 2 ** Math.min(s.failures - 1, 6),
        );
        s.nextAttemptAt =
          this.ports.now() +
          Math.max(
            Math.max(0, (s.automaticAfter ?? 0) - this.ports.now()),
            error instanceof SyncError ? error.retryAfterMs : 0,
            Math.round(backoff * (0.8 + this.ports.random() * 0.4)),
          );
      }
      await this.ports.save(s);
    });
  }
}
