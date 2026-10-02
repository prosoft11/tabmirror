// Development integration boundary; deliberately separate from the fixture API.
import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import {
  ContractError,
  MAX_SNAPSHOT_BYTES,
  parseSnapshot,
  parseStrictJson,
  type Snapshot,
} from '@tabmirror/contracts';
export function createCollector(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new Error('Invalid collector credential.');
  let snapshot: Snapshot | null = null,
    bodyHash = '',
    receivedAt: string | null = null,
    lastVerifiedAt: string | null = null,
    deviceName = 'Local Chrome',
    paused = false,
    revoked = false;
  return createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status: number, value: unknown) => {
      res.writeHead(status);
      res.end(JSON.stringify(value));
    };
    const origin = req.headers.origin;
    const extensionOrigin =
      origin && /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
    if (
      !/^127\.0\.0\.1:\d+$/.test(req.headers.host ?? '') ||
      (origin && !extensionOrigin)
    )
      return send(403, { error: 'Local collector only.' });
    if (extensionOrigin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Authorization, Content-Type',
      );
      res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST');
      res.writeHead(204);
      res.end();
      return;
    }
    const presented = req.headers.authorization ?? '';
    const expected = `Bearer ${token}`;
    if (
      revoked ||
      Buffer.byteLength(presented) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(presented), Buffer.from(expected))
    )
      return send(401, { error: 'Invalid or revoked credential.' });
    const path = req.url;
    if (req.method === 'GET' && path === '/api/device/status')
      return send(200, { revision: snapshot?.revision ?? 0 });
    if (req.method === 'GET' && path === '/api/devices/local/snapshot')
      return send(200, {
        snapshot,
        receivedAt,
        lastVerifiedAt,
        deviceName,
        paused,
      });
    if (req.method === 'POST' && path === '/api/device/disconnect') {
      revoked = true;
      return send(200, { revoked: true });
    }
    if (!(
      (req.method === 'PUT' && path === '/api/device/snapshot') ||
      (req.method === 'POST' && path === '/api/device/heartbeat')
    ))
      return send(404, { error: 'Not found.' });
    if (
      req.headers['content-encoding'] ||
      req.headers['content-type'] !== 'application/json'
    )
      return send(415, { error: 'Uncompressed JSON required.' });
    try {
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_SNAPSHOT_BYTES) {
          send(413, { error: 'Too large.' });
          return;
        }
        chunks.push(chunk);
      }
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(
        Buffer.concat(chunks),
      );
      if (revoked) return send(401, { error: 'Revoked.' });
      if (path === '/api/device/snapshot') {
        const candidate = parseSnapshot(raw);
        const hash = createHash('sha256').update(raw).digest('hex');
        if (snapshot && candidate.revision <= snapshot.revision) {
          if (candidate.revision === snapshot.revision && hash === bodyHash)
            return send(200, { revision: snapshot.revision, receivedAt });
          return send(409, { error: 'Revision conflict.' });
        }
        snapshot = candidate;
        bodyHash = hash;
        receivedAt = new Date().toISOString();
        lastVerifiedAt = receivedAt;
        paused = false;
        return send(200, { revision: snapshot.revision, receivedAt });
      }
      const heartbeat = parseStrictJson(raw) as Record<string, unknown>;
      if (
        !heartbeat ||
        typeof heartbeat !== 'object' ||
        Object.keys(heartbeat).some(
          (k) => !['revision', 'state', 'checkedAt', 'deviceName'].includes(k),
        ) ||
        heartbeat.revision !== (snapshot?.revision ?? 0) ||
        !['active', 'paused'].includes(String(heartbeat.state)) ||
        typeof heartbeat.deviceName !== 'string' ||
        !heartbeat.deviceName.trim() ||
        heartbeat.deviceName.length > 80
      )
        return send(400, { error: 'Invalid heartbeat.' });
      if (
        heartbeat.state === 'active' &&
        (!snapshot ||
          typeof heartbeat.checkedAt !== 'string' ||
          !Number.isFinite(Date.parse(heartbeat.checkedAt)))
      )
        return send(400, { error: 'Unverified heartbeat.' });
      deviceName = heartbeat.deviceName;
      paused = heartbeat.state === 'paused';
      if (!paused) lastVerifiedAt = new Date().toISOString();
      return send(200, { ok: true });
    } catch (error) {
      return send(
        error instanceof ContractError && error.code === 'SNAPSHOT_TOO_LARGE'
          ? 413
          : 400,
        {
          error: 'Invalid snapshot or heartbeat; previous snapshot preserved.',
        },
      );
    }
  });
}
