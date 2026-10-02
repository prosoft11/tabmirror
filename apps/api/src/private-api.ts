import { type IncomingMessage, createServer } from 'node:http';
import { body } from './request-body.js';
import type { AuthRoutes } from './web-auth.js';
import { randomUUID } from 'node:crypto';
import {
  ContractError,
  MAX_SNAPSHOT_BYTES,
  parseSnapshot,
  parseStrictJson,
} from '@tabmirror/contracts';
import {
  ApiError,
  digest,
  type Heartbeat,
  type PrivateStore,
} from './private-store.js';

export interface PrivateApiOptions {
  auth?: AuthRoutes;
  clientIp?: (req: IncomingMessage) => string;
  throttle?: (key: string, maximum: number, windowMs: number) => Promise<void>;
  allowedHosts: string[];
  viewerOrigin: string;
  /** Local development accepts extension origins. Production must pin the installed extension ID. */
  extensionOrigin: RegExp;
  rateLimit?: number;
  clock?: () => number;
  log?: (event: {
    requestId: string;
    operation: string;
    status: number;
    durationMs: number;
  }) => void;
}
function heartbeat(raw: string): Heartbeat {
  const value = parseStrictJson(raw) as Record<string, unknown>;
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (key) => !['revision', 'state', 'checkedAt', 'deviceName'].includes(key),
    ) ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 0 ||
    !['active', 'paused'].includes(String(value.state)) ||
    typeof value.deviceName !== 'string' ||
    !value.deviceName.trim() ||
    value.deviceName.length > 80 ||
    (value.checkedAt !== undefined &&
      (typeof value.checkedAt !== 'string' ||
        !value.checkedAt.endsWith('Z') ||
        !Number.isFinite(Date.parse(value.checkedAt)))) ||
    (value.state === 'active' && value.checkedAt === undefined)
  )
    throw new ApiError(
      400,
      'INVALID_HEARTBEAT',
      'A valid revision, state, name and verification time are required.',
    );
  return value as unknown as Heartbeat;
}
export function createPrivateApi(
  store: PrivateStore,
  options: PrivateApiOptions,
) {
  const clock = options.clock ?? Date.now;
  const buckets = new Map<string, { start: number; count: number }>();
  async function limit(key: string, maximum: number) {
    if (options.throttle) return options.throttle(key, maximum, 60_000);
    const now = clock();
    for (const [id, bucket] of buckets)
      if (now - bucket.start >= 60_000) buckets.delete(id);
    let bucket = buckets.get(key);
    if (!bucket) {
      if (buckets.size >= 10_000)
        throw new ApiError(429, 'RATE_LIMITED', 'Retry in one minute.');
      bucket = { start: now, count: 0 };
      buckets.set(key, bucket);
    }
    if (++bucket.count > maximum)
      throw new ApiError(429, 'RATE_LIMITED', 'Retry in one minute.');
  }
  const server = createServer(async (req, res) => {
    const requestId = randomUUID(),
      start = clock();
    let operation = 'unknown';
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Request-Id', requestId);
    const send = (status: number, value: unknown) => {
      res.writeHead(status);
      res.end(status === 204 ? undefined : JSON.stringify(value));
    };
    res.once('finish', () => {
      // The logger only receives bounded operational metadata, never paths, tokens or input.
      try {
        options.log?.({
          requestId,
          operation,
          status: res.statusCode,
          durationMs: clock() - start,
        });
      } catch {
        /* Logging failures must not change a committed response. */
      }
    });
    try {
      if (!options.allowedHosts.includes(req.headers.host ?? ''))
        throw new ApiError(403, 'FORBIDDEN_ORIGIN', 'Origin not allowed.');
      const path = new URL(req.url ?? '/', options.viewerOrigin).pathname,
        origin = req.headers.origin;
      const deviceRoute = path.startsWith('/api/device/');
      const extensionRoute =
        deviceRoute ||
        ['/api/pairings/start', '/api/pairings/redeem'].includes(path);
      if (
        origin &&
        !(extensionRoute
          ? options.extensionOrigin.test(origin)
          : origin === options.viewerOrigin)
      )
        throw new ApiError(403, 'FORBIDDEN_ORIGIN', 'Origin not allowed.');
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
      }
      await limit(
        `ip:${options.clientIp?.(req) ?? req.socket.remoteAddress ?? 'unknown'}`,
        (options.rateLimit ?? 120) * 4,
      );
      if (req.method === 'OPTIONS') {
        res.setHeader(
          'Access-Control-Allow-Headers',
          'Authorization, Content-Type, X-CSRF-Token',
        );
        res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE');
        return send(204, null);
      }
      if (req.method === 'GET' && path === '/api/health') {
        operation = 'health';
        await store.health();
        return send(200, { ok: true, mode: 'private-local' });
      }
      if (options.auth) {
        if (
          [
            '/api/session',
            '/api/auth/login',
            '/api/auth/logout',
            '/api/auth/callback',
            '/api/pairings/start',
            '/api/pairings/redeem',
            '/api/pairings/lookup',
            '/api/pairings/approve',
            '/api/pairings/deny',
          ].includes(path)
        )
          operation = path.slice(5).replaceAll('/', '-');
        if (await options.auth.handle(req, res, path)) return;
      }
      const match = /^Bearer ([a-f0-9]{64})$/.exec(
        req.headers.authorization ?? '',
      );
      if (!match && (!options.auth || deviceRoute))
        throw new ApiError(
          401,
          'INVALID_CREDENTIAL',
          'Bearer credential required.',
        );
      const hash =
        options.auth && !deviceRoute
          ? await options.auth.viewer(
              req,
              res,
              !['GET', 'HEAD'].includes(req.method ?? ''),
            )
          : digest(match![1]!);
      await limit(`credential:${hash}`, options.rateLimit ?? 120);
      if (deviceRoute) {
        // Fail unauthorized requests before accepting large request bodies. Mutations recheck in their transaction.
        const status = await store.status(hash);
        if (req.method === 'GET' && path === '/api/device/status') {
          operation = 'device-status';
          return send(200, status);
        }
        if (req.method === 'PUT' && path === '/api/device/snapshot') {
          operation = 'snapshot-upload';
          const raw = await body(req, MAX_SNAPSHOT_BYTES);
          if (clock() - start > 300_000)
            throw new ApiError(409, 'UPLOAD_EXPIRED', 'Recapture and retry.');
          return send(200, await store.upload(hash, raw, parseSnapshot(raw)));
        }
        if (req.method === 'POST' && path === '/api/device/heartbeat') {
          operation = 'heartbeat';
          await store.heartbeat(hash, heartbeat(await body(req, 4096)));
          return send(200, { ok: true });
        }
        if (req.method === 'POST' && path === '/api/device/disconnect') {
          operation = 'disconnect';
          await store.disconnect(hash);
          return send(200, { revoked: true });
        }
      } else {
        if (req.method === 'GET' && path === '/api/devices') {
          operation = 'device-list';
          return send(200, { devices: await store.devices(hash) });
        }
        const route =
          /^\/api\/devices\/([a-f0-9-]{36})(\/snapshot|\/revoke)?$/.exec(path);
        if (route) {
          const id = route[1]!;
          if (req.method === 'GET' && route[2] === '/snapshot') {
            operation = 'snapshot-read';
            return send(200, await store.snapshot(hash, id));
          }
          if (req.method === 'POST' && route[2] === '/revoke') {
            operation = 'device-revoke';
            await store.revoke(hash, id);
            return send(200, { revoked: true });
          }
          if (req.method === 'DELETE' && !route[2]) {
            operation = 'device-delete';
            await store.delete(hash, id);
            return send(204, null);
          }
        }
      }
      throw new ApiError(404, 'NOT_FOUND', 'Endpoint not found.');
    } catch (error) {
      const failure =
        error instanceof ApiError
          ? error
          : error instanceof ContractError
            ? new ApiError(
                error.code === 'SNAPSHOT_TOO_LARGE' ? 413 : 400,
                error.code,
                'Invalid snapshot or heartbeat; previous snapshot preserved.',
              )
            : new ApiError(
                503,
                'STORAGE_UNAVAILABLE',
                'Service unavailable. Retry shortly.',
              );
      if (failure.status === 429)
        res.setHeader(
          'Retry-After',
          failure.code === 'SLOW_DOWN' ? '5' : options.auth ? '600' : '60',
        );
      // Drain rejected bodies without buffering so clients receive the error rather than EPIPE.
      // The server request timeout still bounds slow senders.
      if (!req.complete) req.resume();
      send(failure.status, {
        error: {
          code: failure.code,
          message: failure.message,
          retryable: failure.status === 429 || failure.status === 503,
        },
        requestId,
      });
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  return server;
}
