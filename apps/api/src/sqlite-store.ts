import { DatabaseSync } from 'node:sqlite';
import { chmodSync, closeSync, openSync } from 'node:fs';
import type { Snapshot } from '@tabmirror/contracts';
import {
  ApiError,
  digest,
  newCredential,
  newId,
  type DeviceView,
  type Heartbeat,
  type PrivateEnvelope,
  type PrivateStore,
} from './private-store.js';

type Row = Record<string, string | number | null>;
const unauthorized = () =>
  new ApiError(
    401,
    'INVALID_CREDENTIAL',
    'Credential expired, revoked, or invalid.',
  );
const missing = () => new ApiError(404, 'NOT_FOUND', 'Device not found.');
/** Single-host durable adapter. SQLite transactions provide the same publication boundary
 * required of the future DynamoDB/S3 adapter, without intermediate snapshot objects.
 */
export class SqlitePrivateStore implements PrivateStore {
  protected db: DatabaseSync;
  constructor(
    path: string,
    protected clock: () => number = Date.now,
  ) {
    if (path !== ':memory:') {
      const fd = openSync(path, 'a', 0o600);
      closeSync(fd);
      chmodSync(path, 0o600);
    }
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = DELETE;
      PRAGMA synchronous = EXTRA;
      PRAGMA secure_delete = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, active INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS credentials (
        hash TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id),
        scope TEXT NOT NULL CHECK(scope IN ('viewer','device')), device_id TEXT,
        expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL,
        status TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0,
        received_at TEXT, contact_at TEXT, verified_at TEXT, changed_at TEXT,
        body_hash TEXT, content_hash TEXT, snapshot TEXT
      );
      CREATE INDEX IF NOT EXISTS devices_owner ON devices(owner_id);
      CREATE INDEX IF NOT EXISTS credentials_device ON credentials(device_id);
    `);
    const columns = this.db
      .prepare('PRAGMA table_info(credentials)')
      .all() as Row[];
    for (const column of ['issued_at', 'last_used_at', 'renewed_at']) {
      if (!columns.some((row) => row.name === column))
        this.db.exec(`ALTER TABLE credentials ADD COLUMN ${column} INTEGER`);
    }
    this.db
      .prepare(
        'UPDATE credentials SET issued_at=COALESCE(issued_at,?), last_used_at=COALESCE(last_used_at,?), renewed_at=COALESCE(renewed_at,?)',
      )
      .run(this.clock(), this.clock(), this.clock());
  }
  close() {
    this.db.close();
  }
  health() {
    this.db.prepare('SELECT 1').get();
  }
  protected transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = fn();
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  /** Administrative provisioning seam, not an HTTP endpoint. Google/pairing will issue credentials in Phase 5. */
  provision(
    ownerId: string,
    name = 'Local Chrome',
    lifetimeMs = 365 * 86400_000,
  ) {
    const viewerToken = newCredential(),
      deviceToken = newCredential(),
      deviceId = newId();
    this.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO users VALUES (?, 1)').run(ownerId);
      this.db
        .prepare(
          "INSERT INTO devices (id,owner_id,name,status) VALUES (?,?,?,'active')",
        )
        .run(deviceId, ownerId, name);
      const insert = this.db.prepare(
        'INSERT INTO credentials(hash,owner_id,scope,device_id,expires_at,issued_at,last_used_at,renewed_at) VALUES(?,?,?,?,?,?,?,?)',
      );
      insert.run(
        digest(viewerToken),
        ownerId,
        'viewer',
        null,
        this.clock() + lifetimeMs,
        this.clock(),
        this.clock(),
        this.clock(),
      );
      insert.run(
        digest(deviceToken),
        ownerId,
        'device',
        deviceId,
        this.clock() + lifetimeMs,
        this.clock(),
        this.clock(),
        this.clock(),
      );
    });
    return { deviceId, viewerToken, deviceToken };
  }
  setOwnerActive(ownerId: string, active: boolean) {
    this.db
      .prepare('UPDATE users SET active=? WHERE id=?')
      .run(Number(active), ownerId);
  }
  protected authenticate(hash: string, scope: 'viewer' | 'device'): Row {
    const row = this.db
      .prepare(
        `SELECT c.* FROM credentials c JOIN users u ON u.id=c.owner_id
      WHERE c.hash=? AND c.scope=? AND c.revoked=0 AND c.expires_at>? AND u.active=1`,
      )
      .get(hash, scope, this.clock()) as Row | undefined;
    if (!row) throw unauthorized();
    if (scope === 'device') {
      const now = this.clock();
      const renew = now - Number(row.renewed_at) >= 86_400_000;
      this.db
        .prepare(
          'UPDATE credentials SET last_used_at=?, expires_at=?, renewed_at=? WHERE hash=?',
        )
        .run(
          now,
          renew ? now + 365 * 86_400_000 : row.expires_at!,
          renew ? now : row.renewed_at!,
          hash,
        );
    }
    return row;
  }
  private device(hash: string): Row {
    const identity = this.authenticate(hash, 'device');
    const row = this.db
      .prepare(
        "SELECT * FROM devices WHERE id=? AND owner_id=? AND status!='revoked'",
      )
      .get(identity.device_id!, identity.owner_id!) as Row | undefined;
    if (!row) throw unauthorized();
    return row;
  }
  private owned(hash: string, id: string): Row {
    const identity = this.authenticate(hash, 'viewer');
    const row = this.db
      .prepare('SELECT * FROM devices WHERE id=? AND owner_id=?')
      .get(id, identity.owner_id!) as Row | undefined;
    if (!row) throw missing();
    return row;
  }
  private view(row: Row): DeviceView {
    return {
      id: String(row.id),
      name: String(row.name),
      status: row.status as DeviceView['status'],
      revision: Number(row.revision),
      receivedAt: row.received_at as string | null,
      lastContactAt: row.contact_at as string | null,
      lastVerifiedAt: row.verified_at as string | null,
      lastContentChangedAt: row.changed_at as string | null,
    };
  }
  status(hash: string) {
    return this.transaction(() => ({
      revision: Number(this.device(hash).revision),
    }));
  }
  upload(hash: string, raw: string, snapshot: Snapshot) {
    return this.transaction(() => {
      const row = this.device(hash),
        bodyHash = digest(raw),
        now = new Date(this.clock()).toISOString();
      if (snapshot.revision <= Number(row.revision)) {
        if (snapshot.revision !== row.revision || bodyHash !== row.body_hash)
          throw new ApiError(
            409,
            'REVISION_CONFLICT',
            'Resnapshot using a revision above the current revision.',
          );
        this.db
          .prepare('UPDATE devices SET contact_at=? WHERE id=?')
          .run(now, row.id!);
        return {
          revision: snapshot.revision,
          receivedAt: String(row.received_at),
        };
      }
      // Capture time and revision can change while the actual tab content remains unchanged.
      const { capturedAt: _time, revision: _revision, ...content } = snapshot;
      const contentHash = digest(JSON.stringify(content));
      this.db
        .prepare(
          `UPDATE devices SET revision=?,snapshot=?,body_hash=?,content_hash=?,
        received_at=?,contact_at=?,verified_at=?,changed_at=?,status='active' WHERE id=?`,
        )
        .run(
          snapshot.revision,
          raw,
          bodyHash,
          contentHash,
          now,
          now,
          now,
          row.content_hash === contentHash ? row.changed_at! : now,
          row.id!,
        );
      return { revision: snapshot.revision, receivedAt: now };
    });
  }
  heartbeat(hash: string, value: Heartbeat) {
    this.transaction(() => {
      const row = this.device(hash);
      if (row.revision !== value.revision)
        throw new ApiError(
          409,
          'REVISION_CONFLICT',
          'Resnapshot before verifying this revision.',
        );
      if (value.state === 'active' && row.snapshot === null)
        throw new ApiError(
          400,
          'INVALID_HEARTBEAT',
          'Upload a complete snapshot first.',
        );
      const now = new Date(this.clock()).toISOString();
      this.db
        .prepare(
          'UPDATE devices SET name=?,status=?,contact_at=?,verified_at=? WHERE id=?',
        )
        .run(
          value.deviceName,
          value.state,
          now,
          value.state === 'active' ? now : row.verified_at!,
          row.id!,
        );
    });
  }
  disconnect(hash: string) {
    this.transaction(() => {
      const row = this.device(hash);
      this.revokeDevice(String(row.id));
    });
  }
  private revokeDevice(id: string) {
    this.db.prepare("UPDATE devices SET status='revoked' WHERE id=?").run(id);
    this.db
      .prepare('UPDATE credentials SET revoked=1 WHERE device_id=?')
      .run(id);
  }
  devices(hash: string) {
    return this.transaction(() => {
      const identity = this.authenticate(hash, 'viewer');
      return (
        this.db
          .prepare(
            'SELECT id,name,status,revision,received_at,contact_at,verified_at,changed_at FROM devices WHERE owner_id=? ORDER BY id',
          )
          .all(identity.owner_id!) as Row[]
      ).map((row) => this.view(row));
    });
  }
  snapshot(hash: string, id: string): PrivateEnvelope {
    return this.transaction(() => {
      const row = this.owned(hash, id),
        device = this.view(row);
      return {
        device,
        receivedAt: device.receivedAt,
        lastContactAt: device.lastContactAt,
        lastVerifiedAt: device.lastVerifiedAt,
        lastContentChangedAt: device.lastContentChangedAt,
        snapshot:
          row.snapshot === null
            ? null
            : (JSON.parse(String(row.snapshot)) as Snapshot),
      };
    });
  }
  revoke(hash: string, id: string) {
    this.transaction(() => {
      this.owned(hash, id);
      this.revokeDevice(id);
    });
  }
  delete(hash: string, id: string) {
    this.transaction(() => {
      this.owned(hash, id);
      this.db.prepare('DELETE FROM credentials WHERE device_id=?').run(id);
      this.db.prepare('DELETE FROM devices WHERE id=?').run(id);
    });
  }
}
