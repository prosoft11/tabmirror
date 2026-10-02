import { randomBytes } from 'node:crypto';
import { SqlitePrivateStore } from './sqlite-store.js';
import { ApiError, digest, newCredential, newId } from './private-store.js';
import {
  DAY,
  YEAR,
  LOGIN_TTL,
  type GoogleIdentity,
  type Session,
  type AuthStore,
} from './auth-contract.js';
export {
  DAY,
  YEAR,
  LOGIN_TTL,
  type GoogleIdentity,
  type Session,
} from './auth-contract.js';
type Row = Record<string, string | number | null>;
const denied = () => new ApiError(401, 'SIGNED_OUT', 'Please sign in again.');
const pairingGone = () =>
  new ApiError(
    410,
    'PAIRING_UNAVAILABLE',
    'Pairing expired, denied, or already used. Start a new pairing.',
  );
export class SqliteAuthStore extends SqlitePrivateStore implements AuthStore {
  constructor(path: string, clock: () => number = Date.now) {
    super(path, clock);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS google_users (subject TEXT PRIMARY KEY, owner_id TEXT NOT NULL UNIQUE REFERENCES users(id), email TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY REFERENCES credentials(hash) ON DELETE CASCADE, renewed_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS logins (hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS pairings (id TEXT PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE, challenge TEXT NOT NULL, name TEXT NOT NULL,
        expires_at INTEGER NOT NULL, state TEXT NOT NULL, owner_id TEXT, attempts INTEGER NOT NULL DEFAULT 0, last_poll INTEGER);
      CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, start INTEGER NOT NULL, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    `);
  }
  /** Durable limits commit rejected attempts as well as accepted attempts. Keys contain hashes, not raw IPs. */
  throttle(key: string, maximum: number, windowMs: number) {
    const allowed = this.transaction(() => {
      const now = this.clock();
      this.db.prepare('DELETE FROM rate_limits WHERE expires_at<=?').run(now);
      const row = this.db
        .prepare('SELECT * FROM rate_limits WHERE key=?')
        .get(key) as Row | undefined;
      if (!row) {
        const count = this.db
          .prepare('SELECT count(*) AS n FROM rate_limits')
          .get() as Row;
        if (Number(count.n) >= 10_000) return false;
        this.db
          .prepare('INSERT INTO rate_limits VALUES(?,?,1,?)')
          .run(key, now, now + windowMs);
        return true;
      }
      this.db
        .prepare('UPDATE rate_limits SET count=count+1 WHERE key=?')
        .run(key);
      return Number(row.count) < maximum;
    });
    if (!allowed)
      throw new ApiError(
        429,
        'RATE_LIMITED',
        'Too many attempts. Wait before trying again.',
      );
  }
  beginLogin(hash: string) {
    this.transaction(() => {
      this.db
        .prepare('DELETE FROM logins WHERE expires_at<=?')
        .run(this.clock());
      this.db
        .prepare('INSERT INTO logins VALUES(?,?)')
        .run(hash, this.clock() + LOGIN_TTL);
    });
  }
  consumeLogin(hash: string) {
    const valid = this.transaction(() => {
      const row = this.db
        .prepare('SELECT expires_at FROM logins WHERE hash=?')
        .get(hash) as Row | undefined;
      this.db.prepare('DELETE FROM logins WHERE hash=?').run(hash);
      return row && Number(row.expires_at) > this.clock();
    });
    if (!valid) throw denied();
  }
  configureAllowlist(emails: string[]) {
    this.transaction(() => {
      for (const row of this.db
        .prepare('SELECT owner_id,email FROM google_users')
        .all() as Row[]) {
        if (!emails.includes(String(row.email))) {
          this.db
            .prepare('UPDATE users SET active=0 WHERE id=?')
            .run(row.owner_id!);
          this.db
            .prepare('UPDATE credentials SET revoked=1 WHERE owner_id=?')
            .run(row.owner_id!);
        }
      }
    });
  }
  signIn(
    identity: GoogleIdentity,
    allowedEmails: string[],
    previousHash?: string,
  ) {
    if (
      !identity.emailVerified ||
      !identity.subject ||
      !identity.email ||
      !allowedEmails.includes(identity.email.toLowerCase())
    )
      throw new ApiError(
        403,
        'ACCOUNT_NOT_ALLOWED',
        'This Google account is not approved.',
      );
    const token = newCredential();
    const expiresAt = this.clock() + YEAR;
    this.transaction(() => {
      const email = identity.email.toLowerCase();
      let existing = this.db
        .prepare('SELECT * FROM google_users WHERE subject=?')
        .get(identity.subject) as Row | undefined;
      const boundEmail = this.db
        .prepare('SELECT subject FROM google_users WHERE email=?')
        .get(email) as Row | undefined;
      if (boundEmail && boundEmail.subject !== identity.subject)
        throw new ApiError(
          403,
          'ACCOUNT_NOT_ALLOWED',
          'Account enrollment requires administrator review.',
        );
      if (!existing) {
        const ownerId = newId();
        this.db.prepare('INSERT INTO users VALUES(?,1)').run(ownerId);
        this.db
          .prepare('INSERT INTO google_users VALUES(?,?,?)')
          .run(identity.subject, ownerId, email);
        existing = { owner_id: ownerId };
      } else {
        const user = this.db
          .prepare('SELECT active FROM users WHERE id=?')
          .get(existing.owner_id!) as Row;
        if (!user.active)
          throw new ApiError(
            403,
            'ACCOUNT_NOT_ALLOWED',
            'Account access is disabled.',
          );
        this.db
          .prepare('UPDATE google_users SET email=? WHERE subject=?')
          .run(email, identity.subject);
      }
      // Re-authentication rotates the browser's prior session, even when changing accounts.
      if (previousHash)
        this.db
          .prepare(
            "DELETE FROM credentials WHERE hash=? AND scope='viewer' AND hash IN (SELECT hash FROM sessions)",
          )
          .run(previousHash);
      this.db
        .prepare(
          "INSERT INTO credentials(hash,owner_id,scope,device_id,expires_at,issued_at,last_used_at,renewed_at) VALUES(?,?,'viewer',NULL,?,?,?,?)",
        )
        .run(
          digest(token),
          existing.owner_id!,
          expiresAt,
          this.clock(),
          this.clock(),
          this.clock(),
        );
      this.db
        .prepare('INSERT INTO sessions VALUES(?,?)')
        .run(digest(token), this.clock());
    });
    return { token, expiresAt };
  }
  session(hash: string): Session {
    return this.transaction(() => {
      const identity = this.authenticate(hash, 'viewer');
      const row = this.db
        .prepare(
          'SELECT s.renewed_at,g.email FROM sessions s JOIN google_users g ON g.owner_id=? WHERE s.hash=?',
        )
        .get(identity.owner_id!, hash) as Row | undefined;
      if (!row) throw denied();
      const renewed = this.clock() - Number(row.renewed_at) >= DAY;
      const expiresAt = renewed
        ? this.clock() + YEAR
        : Number(identity.expires_at);
      if (renewed) {
        this.db
          .prepare('UPDATE sessions SET renewed_at=? WHERE hash=?')
          .run(this.clock(), hash);
        this.db
          .prepare(
            'UPDATE credentials SET expires_at=?,renewed_at=? WHERE hash=?',
          )
          .run(expiresAt, this.clock(), hash);
      }
      this.db
        .prepare('UPDATE credentials SET last_used_at=? WHERE hash=?')
        .run(this.clock(), hash);
      return { email: String(row.email), expiresAt, renewed };
    });
  }
  logout(hash: string) {
    this.transaction(() => {
      this.db
        .prepare(
          'DELETE FROM credentials WHERE hash=? AND hash IN (SELECT hash FROM sessions)',
        )
        .run(hash);
    });
  }
  createPairing(challenge: string, name: string) {
    return this.transaction(() => {
      this.db
        .prepare('DELETE FROM pairings WHERE expires_at<=?')
        .run(this.clock());
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      // Exactly 32 symbols, eight uniform draws = 40 bits.
      let code = '';
      for (let attempt = 0; attempt < 10; attempt++) {
        code = Array.from(randomBytes(8), (byte) => alphabet[byte & 31]).join(
          '',
        );
        if (
          !this.db
            .prepare('SELECT id FROM pairings WHERE code_hash=?')
            .get(digest(code))
        )
          break;
        if (attempt === 9)
          throw new ApiError(
            503,
            'PAIRING_UNAVAILABLE',
            'Try creating a pairing again.',
          );
      }
      const id = newId(),
        expiresAt = this.clock() + LOGIN_TTL;
      this.db
        .prepare(
          "INSERT INTO pairings(id,code_hash,challenge,name,expires_at,state) VALUES(?,?,?,?,?,'pending')",
        )
        .run(id, digest(code), challenge, name, expiresAt);
      return { id, code, name, expiresAt };
    });
  }
  private pendingPair(code: string, id?: string): Row {
    const row = this.db
      .prepare(
        "SELECT * FROM pairings WHERE code_hash=? AND state='pending' AND expires_at>?",
      )
      .get(digest(code), this.clock()) as Row | undefined;
    if (!row || (id !== undefined && row.id !== id)) throw pairingGone();
    return row;
  }
  lookupPairing(hash: string, code: string) {
    return this.transaction(() => {
      this.authenticate(hash, 'viewer');
      const row = this.pendingPair(code);
      return {
        id: String(row.id),
        code,
        name: String(row.name),
        expiresAt: Number(row.expires_at),
      };
    });
  }
  approvePairing(hash: string, code: string, id: string, approve: boolean) {
    this.transaction(() => {
      const identity = this.authenticate(hash, 'viewer');
      this.pendingPair(code, id);
      if (approve) this.ensureAvailable(String(identity.owner_id));
      this.db
        .prepare('UPDATE pairings SET state=?,owner_id=? WHERE id=?')
        .run(approve ? 'approved' : 'denied', identity.owner_id!, id);
    });
  }
  private ensureAvailable(ownerId: string) {
    const active = this.db
      .prepare("SELECT id FROM devices WHERE owner_id=? AND status!='revoked'")
      .get(ownerId);
    const reservation = this.db
      .prepare(
        "SELECT id FROM pairings WHERE owner_id=? AND state='approved' AND expires_at>?",
      )
      .get(ownerId, this.clock());
    if (active || reservation)
      throw new ApiError(
        409,
        'DEVICE_ALREADY_PAIRED',
        'Revoke or delete the existing device, or wait for the approved pairing to expire, before replacing it.',
      );
  }
  redeemPairing(id: string, verifier: string) {
    const result = this.transaction(() => {
      const row = this.db
        .prepare('SELECT * FROM pairings WHERE id=? AND expires_at>?')
        .get(id, this.clock()) as Row | undefined;
      if (!row || !['pending', 'approved'].includes(String(row.state)))
        return pairingGone();
      if (row.last_poll !== null && this.clock() - Number(row.last_poll) < 5000)
        return new ApiError(
          429,
          'SLOW_DOWN',
          'Poll no faster than every five seconds.',
        );
      this.db
        .prepare('UPDATE pairings SET last_poll=? WHERE id=?')
        .run(this.clock(), id);
      if (digest(verifier) !== row.challenge) {
        this.db
          .prepare(
            "UPDATE pairings SET attempts=attempts+1, state=CASE WHEN attempts>=4 THEN 'denied' ELSE state END WHERE id=?",
          )
          .run(id);
        return new ApiError(
          401,
          'INVALID_VERIFIER',
          'Pairing verifier is invalid.',
        );
      }
      if (row.state === 'pending') return { status: 'pending' as const };
      const user = this.db
        .prepare('SELECT active FROM users WHERE id=?')
        .get(row.owner_id!) as Row | undefined;
      if (!user?.active) return pairingGone();
      if (
        this.db
          .prepare(
            "SELECT id FROM devices WHERE owner_id=? AND status!='revoked'",
          )
          .get(row.owner_id!)
      )
        return new ApiError(
          409,
          'DEVICE_ALREADY_PAIRED',
          'Revoke the existing device first.',
        );
      const token = newCredential(),
        deviceId = newId();
      this.db
        .prepare(
          "INSERT INTO devices(id,owner_id,name,status) VALUES(?,?,?,'active')",
        )
        .run(deviceId, row.owner_id!, row.name!);
      this.db
        .prepare(
          "INSERT INTO credentials(hash,owner_id,scope,device_id,expires_at,issued_at,last_used_at,renewed_at) VALUES(?,?,'device',?,?,?,?,?)",
        )
        .run(
          digest(token),
          row.owner_id!,
          deviceId,
          this.clock() + YEAR,
          this.clock(),
          this.clock(),
          this.clock(),
        );
      this.db
        .prepare("UPDATE pairings SET state='consumed',challenge='' WHERE id=?")
        .run(id);
      return {
        status: 'paired' as const,
        token,
        deviceId,
        name: String(row.name),
      };
    });
    if (result instanceof ApiError) throw result;
    return result;
  }
}
