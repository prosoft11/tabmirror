import { createServer, type IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  ContractError,
  parseSnapshot,
  type SnapshotEnvelope,
} from '@tabmirror/contracts';
import {
  makeFixture,
  fixtureNames,
} from '../../../packages/contracts/src/fixtures';
import { readConfig } from './config';
import { LocalFixtureAuthenticator } from './auth';
import { MemorySnapshotStore, type SnapshotStore } from './store';
function isLocalRequest(req: IncomingMessage, ports: number[]) {
  const allowed = ports.map((port) => `127.0.0.1:${port}`);
  if (!allowed.includes(req.headers.host ?? '')) return false;
  if (
    req.headers.origin &&
    !allowed.map((host) => `http://${host}`).includes(req.headers.origin)
  )
    return false;
  return (
    !req.headers['sec-fetch-site'] ||
    ['same-origin', 'same-site', 'none'].includes(
      String(req.headers['sec-fetch-site']),
    )
  );
}
export function createLocalApp(
  env: NodeJS.ProcessEnv,
  store: SnapshotStore = new MemorySnapshotStore(),
) {
  const config = readConfig(env);
  const auth = new LocalFixtureAuthenticator();
  const server = createServer(async (req, res) => {
    const requestId = randomUUID();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status: number, data: unknown) => {
      res.writeHead(status);
      res.end(JSON.stringify(data));
    };
    const error = (status: number, code: string, message: string) =>
      send(status, {
        error: { code, message, retryable: status >= 500 },
        requestId,
      });
    if (!isLocalRequest(req, [config.port, config.webPort]))
      return error(
        403,
        'LOCAL_ONLY',
        'This preview is available only on loopback.',
      );
    if (req.method !== 'GET')
      return error(405, 'METHOD_NOT_ALLOWED', 'Phase 2 preview is read-only.');
    try {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${config.port}`);
      if (url.pathname === '/api/health')
        return send(200, { status: 'ok', mode: 'local-fixtures' });
      const identity = await auth.authenticate();
      if (url.pathname === '/api/session')
        return send(200, {
          mode: identity.mode,
          displayName: 'Local preview',
          authenticated: false,
        });
      if (url.pathname === '/api/devices')
        return send(200, {
          devices: fixtureNames.map((name) => ({
            id: name,
            name: `${name} fixture`,
            status: 'active',
          })),
        });
      const match = /^\/api\/devices\/(mixed|empty|large)\/snapshot$/.exec(
        url.pathname,
      );
      if (!match) return error(404, 'NOT_FOUND', 'Resource not found.');
      const name = match[1] as (typeof fixtureNames)[number];
      let envelope = await store.get(identity.ownerId, name);
      if (!envelope) {
        const snapshot = parseSnapshot(JSON.stringify(makeFixture(name)));
        envelope = {
          device: { id: name, name: 'Example MacBook', status: 'active' },
          receivedAt: snapshot.capturedAt,
          lastContactAt: snapshot.capturedAt,
          lastVerifiedAt: snapshot.capturedAt,
          snapshot,
        } satisfies SnapshotEnvelope;
        await store.replace(identity.ownerId, envelope);
      }
      return send(200, envelope);
    } catch (err) {
      if (err instanceof ContractError)
        return error(500, 'FIXTURE_INVALID', 'Fixture validation failed.');
      return error(500, 'INTERNAL_ERROR', 'Unable to load preview.');
    }
  });
  return { server, config };
}
