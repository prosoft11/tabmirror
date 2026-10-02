import { randomBytes } from 'node:crypto';
import { parseSnapshot, type Snapshot } from '@tabmirror/contracts';
import {
  DAY,
  YEAR,
  LOGIN_TTL,
  type AuthStore,
  type GoogleIdentity,
  type Session,
  type Redemption,
} from '../auth-contract.js';
import {
  ApiError,
  digest,
  newCredential,
  newId,
  type DeviceView,
  type Heartbeat,
  type PrivateEnvelope,
} from '../private-store.js';
import {
  transact,
  type Backend,
  type Transaction,
  type Row,
} from './transactions.js';
import type { Objects } from './objects.js';
const denied = () =>
  new ApiError(
    401,
    'INVALID_CREDENTIAL',
    'Credential expired, revoked, or invalid.',
  );
const gone = () =>
  new ApiError(
    410,
    'PAIRING_UNAVAILABLE',
    'Pairing expired, denied, or already used. Start a new pairing.',
  );
const missing = () => new ApiError(404, 'NOT_FOUND', 'Device not found.');
const conflict = () =>
  new ApiError(
    409,
    'REVISION_CONFLICT',
    'Resnapshot using a revision above the current revision.',
  );
const occupied = () =>
  new ApiError(
    409,
    'DEVICE_ALREADY_PAIRED',
    'Revoke the existing device or wait for the approved pairing to expire.',
  );
const expires = (ms: number) => ({ expiresAt: ms, ttl: Math.ceil(ms / 1000) });
export class CloudStore implements AuthStore {
  private emails: string[] = [];
  constructor(
    private backend: Backend,
    private objects: Objects,
    private clock: () => number = Date.now,
  ) {}
  private run<T>(work: (tx: Transaction) => Promise<T>) {
    return transact(this.backend, work);
  }
  async configureAllowlist(emails: string[]) {
    this.emails = [...emails];
    const catalog = await this.backend.query('USERS', 'USER#');
    for (const entry of catalog)
      await this.run(async (tx) => {
        const owner = await tx.get(`OWNER#${entry.owner}`);
        if (owner && !emails.includes(owner.email))
          await tx.put(owner.pk, { ...owner, active: false });
      });
  }
  private async auth(
    tx: Transaction,
    hash: string,
    scope: 'viewer' | 'device',
  ) {
    const credential = await tx.get(`TOKEN#${hash}`);
    if (
      !credential ||
      credential.scope !== scope ||
      credential.expiresAt <= this.clock()
    )
      throw denied();
    tx.beforeCommit(() => {
      if (credential.expiresAt <= this.clock()) throw denied();
    });
    const owner = await tx.get(`OWNER#${credential.owner}`);
    if (!owner?.active || !this.emails.includes(owner.email)) throw denied();
    if (scope === 'device' && this.clock() - credential.renewedAt >= DAY)
      await tx.put(credential.pk, {
        ...credential,
        ...expires(this.clock() + YEAR),
        renewedAt: this.clock(),
      });
    return { credential, owner };
  }
  private async device(tx: Transaction, hash: string) {
    const identity = await this.auth(tx, hash, 'device');
    const device = await tx.get(
      identity.owner.pk,
      `DEVICE#${identity.credential.deviceId}`,
    );
    if (!device || device.status === 'revoked') throw denied();
    return { ...identity, device };
  }
  private async owned(tx: Transaction, hash: string, id: string) {
    const identity = await this.auth(tx, hash, 'viewer');
    const device = await tx.get(identity.owner.pk, `DEVICE#${id}`);
    if (!device) throw missing();
    return { ...identity, device };
  }
  private view(row: Row): DeviceView {
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      revision: row.revision,
      receivedAt: row.receivedAt ?? null,
      lastContactAt: row.lastContactAt ?? null,
      lastVerifiedAt: row.lastVerifiedAt ?? null,
      lastContentChangedAt: row.lastContentChangedAt ?? null,
    };
  }
  async throttle(key: string, maximum: number, windowMs: number) {
    await this.run(async (tx) => {
      const pk = `RATE#${digest(key)}`,
        row = await tx.get(pk),
        now = this.clock();
      if (!row || row.expiresAt <= now) {
        await tx.put(pk, { count: 1, ...expires(now + windowMs) });
        return;
      }
      if (row.count >= maximum)
        return new ApiError(
          429,
          'RATE_LIMITED',
          'Too many attempts. Wait before trying again.',
        );
      await tx.put(pk, { ...row, count: row.count + 1 });
    });
  }
  async beginLogin(hash: string) {
    await this.run(async (tx) => {
      await tx.put(`LOGIN#${hash}`, expires(this.clock() + LOGIN_TTL));
    });
  }
  async consumeLogin(hash: string) {
    await this.run(async (tx) => {
      const row = await tx.get(`LOGIN#${hash}`);
      await tx.delete(`LOGIN#${hash}`);
      if (!row || row.expiresAt <= this.clock()) return denied();
    });
  }
  async signIn(
    identity: GoogleIdentity,
    allowedEmails: string[],
    previousHash?: string,
  ) {
    const email = identity.email.toLowerCase();
    if (
      !identity.emailVerified ||
      !identity.subject ||
      !allowedEmails.includes(email) ||
      !this.emails.includes(email)
    )
      throw new ApiError(
        403,
        'ACCOUNT_NOT_ALLOWED',
        'This Google account is not approved.',
      );
    const ownerId = digest(identity.subject),
      pk = `OWNER#${ownerId}`,
      token = newCredential();
    return this.run(async (tx) => {
      const owner = await tx.get(pk),
        binding = await tx.get(`EMAIL#${digest(email)}`);
      if ((binding && binding.owner !== ownerId) || (owner && !owner.active))
        throw new ApiError(
          403,
          'ACCOUNT_NOT_ALLOWED',
          'Account enrollment requires administrator review.',
        );
      if (owner && owner.email !== email)
        await tx.delete(`EMAIL#${digest(owner.email)}`);
      await tx.put(pk, { ...owner, id: ownerId, email, active: true });
      await tx.put(`EMAIL#${digest(email)}`, { owner: ownerId });
      await tx.put('USERS', { owner: ownerId }, `USER#${ownerId}`);
      if (previousHash) {
        const old = await tx.get(`TOKEN#${previousHash}`);
        if (old?.scope === 'viewer') await tx.delete(old.pk);
      }
      const expiresAt = this.clock() + YEAR;
      await tx.put(`TOKEN#${digest(token)}`, {
        owner: ownerId,
        scope: 'viewer',
        renewedAt: this.clock(),
        ...expires(expiresAt),
      });
      return { token, expiresAt };
    });
  }
  async session(hash: string): Promise<Session> {
    return this.run(async (tx) => {
      const { credential, owner } = await this.auth(tx, hash, 'viewer');
      const renewed = this.clock() - credential.renewedAt >= DAY;
      const expiresAt = renewed ? this.clock() + YEAR : credential.expiresAt;
      if (renewed)
        await tx.put(credential.pk, {
          ...credential,
          ...expires(expiresAt),
          renewedAt: this.clock(),
        });
      return { email: owner.email, expiresAt, renewed };
    });
  }
  async logout(hash: string) {
    await this.run(async (tx) => {
      const row = await tx.get(`TOKEN#${hash}`);
      if (row?.scope === 'viewer') await tx.delete(row.pk);
    });
  }
  async createPairing(challenge: string, name: string) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
        code = Array.from(randomBytes(8), (byte) => alphabet[byte & 31]).join(
          '',
        ),
        id = newId();
      const result = await this.run(async (tx) => {
        const key = `CODE#${digest(code)}`,
          existing = await tx.get(key);
        if (existing && existing.expiresAt > this.clock()) return null;
        const expiresAt = this.clock() + LOGIN_TTL;
        await tx.put(key, { id, ...expires(expiresAt) });
        await tx.put(`PAIR#${id}`, {
          id,
          challenge,
          name,
          codeHash: digest(code),
          state: 'pending',
          attempts: 0,
          ...expires(expiresAt),
        });
        return { id, code, name, expiresAt };
      });
      if (result) return result;
    }
    throw new ApiError(
      503,
      'PAIRING_UNAVAILABLE',
      'Try creating a pairing again.',
    );
  }
  private async pending(tx: Transaction, code: string, id?: string) {
    const lookup = await tx.get(`CODE#${digest(code)}`);
    if (!lookup || lookup.expiresAt <= this.clock() || (id && id !== lookup.id))
      throw gone();
    const pair = await tx.get(`PAIR#${lookup.id}`);
    if (!pair || pair.state !== 'pending' || pair.expiresAt <= this.clock())
      throw gone();
    return pair;
  }
  async lookupPairing(hash: string, code: string) {
    return this.run(async (tx) => {
      await this.auth(tx, hash, 'viewer');
      const pair = await this.pending(tx, code);
      return {
        id: pair.id as string,
        code,
        name: pair.name as string,
        expiresAt: pair.expiresAt as number,
      };
    });
  }
  async approvePairing(
    hash: string,
    code: string,
    id: string,
    approve: boolean,
  ) {
    await this.run(async (tx) => {
      const { owner } = await this.auth(tx, hash, 'viewer'),
        pair = await this.pending(tx, code, id);
      if (approve) {
        if (owner.activeDevice || owner.reservedUntil > this.clock())
          throw occupied();
        await tx.put(owner.pk, {
          ...owner,
          reservation: id,
          reservedUntil: pair.expiresAt,
        });
      }
      await tx.put(pair.pk, {
        ...pair,
        owner: owner.id,
        state: approve ? 'approved' : 'denied',
      });
    });
  }
  async redeemPairing(id: string, verifier: string): Promise<Redemption> {
    const token = newCredential(),
      deviceId = newId();
    return this.run(async (tx) => {
      const row = await tx.get(`PAIR#${id}`),
        now = this.clock();
      if (
        !row ||
        row.expiresAt <= now ||
        !['pending', 'approved'].includes(row.state)
      )
        return gone();
      if (row.lastPoll !== undefined && now - row.lastPoll < 5000)
        return new ApiError(
          429,
          'SLOW_DOWN',
          'Poll no faster than every five seconds.',
        );
      if (row.challenge !== digest(verifier)) {
        await tx.put(row.pk, {
          ...row,
          lastPoll: now,
          attempts: row.attempts + 1,
          state: row.attempts >= 4 ? 'denied' : row.state,
        });
        return new ApiError(
          401,
          'INVALID_VERIFIER',
          'Pairing verifier is invalid.',
        );
      }
      if (row.state === 'pending') {
        await tx.put(row.pk, { ...row, lastPoll: now });
        return { status: 'pending' as const };
      }
      const owner = await tx.get(`OWNER#${row.owner}`);
      if (!owner?.active || !this.emails.includes(owner.email)) return gone();
      if (owner.activeDevice) return occupied();
      if (owner.reservation !== id) return gone();
      await tx.put(owner.pk, {
        ...owner,
        activeDevice: deviceId,
        reservation: null,
        reservedUntil: 0,
      });
      await tx.put(
        owner.pk,
        {
          id: deviceId,
          name: row.name,
          status: 'active',
          revision: 0,
          credentialHash: digest(token),
        },
        `DEVICE#${deviceId}`,
      );
      await tx.put(`TOKEN#${digest(token)}`, {
        owner: owner.id,
        deviceId,
        scope: 'device',
        renewedAt: now,
        ...expires(now + YEAR),
      });
      await tx.put(row.pk, {
        ...row,
        state: 'consumed',
        challenge: '',
        lastPoll: now,
      });
      return {
        status: 'paired' as const,
        token,
        deviceId,
        name: row.name as string,
      };
    });
  }
  async status(hash: string) {
    return this.run(async (tx) => ({
      revision: (await this.device(tx, hash)).device.revision as number,
    }));
  }
  async health() {
    await this.backend.get('HEALTH', 'META');
  }
  async devices(hash: string) {
    return this.run(async (tx) => {
      const { owner } = await this.auth(tx, hash, 'viewer');
      // Owner version changes on creation/deletion; commit rejects a torn list.
      return (await this.backend.query(owner.pk, 'DEVICE#')).map((row) =>
        this.view(row),
      );
    });
  }
  async snapshot(hash: string, id: string): Promise<PrivateEnvelope> {
    return this.run(async (tx) => {
      const { device: row } = await this.owned(tx, hash, id);
      const snapshot = row.objectKey
        ? parseSnapshot(await this.objects.get(row.objectKey))
        : null;
      const device = this.view(row);
      return {
        device,
        receivedAt: device.receivedAt,
        lastContactAt: device.lastContactAt,
        lastVerifiedAt: device.lastVerifiedAt,
        lastContentChangedAt: device.lastContentChangedAt,
        snapshot,
      };
    });
  }
  private async garbage(tx: Transaction, key: string) {
    const object = await tx.get('OBJECTS', key);
    if (object)
      await tx.put(
        'OBJECTS',
        {
          ...object,
          state: 'garbage',
          dueAt: this.clock(),
          retiredAt: this.clock(),
        },
        key,
      );
  }
  async upload(hash: string, raw: string, snapshot: Snapshot) {
    // Authenticate before creating an object, then recheck at atomic publication.
    await this.status(hash);
    const objectKey = `snapshots/${newId()}`;
    await this.run(async (tx) => {
      await tx.put(
        'OBJECTS',
        {
          state: 'staging',
          dueAt: this.clock() + 15 * 60_000,
          createdAt: this.clock(),
        },
        objectKey,
      );
    });
    await this.objects.put(objectKey, raw);
    return this.run(async (tx) => {
      const { device: row } = await this.device(tx, hash),
        object = await tx.get('OBJECTS', objectKey);
      if (!object || object.state !== 'staging' || object.dueAt <= this.clock())
        throw new ApiError(503, 'UPLOAD_EXPIRED', 'Retry the upload.');
      tx.beforeCommit(() => {
        if (object.dueAt <= this.clock())
          throw new ApiError(503, 'UPLOAD_EXPIRED', 'Retry the upload.');
      });
      const bodyHash = digest(raw),
        now = new Date(this.clock()).toISOString();
      if (snapshot.revision <= row.revision) {
        await this.garbage(tx, objectKey);
        if (snapshot.revision !== row.revision || bodyHash !== row.bodyHash)
          return conflict();
        await tx.put(row.pk, { ...row, lastContactAt: now }, row.sk);
        return {
          revision: snapshot.revision,
          receivedAt: row.receivedAt as string,
        };
      }
      const { capturedAt: _time, revision: _revision, ...content } = snapshot;
      const contentHash = digest(JSON.stringify(content));
      if (row.objectKey) await this.garbage(tx, row.objectKey);
      await tx.put(
        'OBJECTS',
        { ...object, state: 'live', dueAt: null },
        objectKey,
      );
      await tx.put(
        row.pk,
        {
          ...row,
          objectKey,
          revision: snapshot.revision,
          bodyHash,
          contentHash,
          receivedAt: now,
          lastContactAt: now,
          lastVerifiedAt: now,
          lastContentChangedAt:
            contentHash === row.contentHash ? row.lastContentChangedAt : now,
          status: 'active',
        },
        row.sk,
      );
      return { revision: snapshot.revision, receivedAt: now };
    });
  }
  async heartbeat(hash: string, value: Heartbeat) {
    await this.run(async (tx) => {
      const { device } = await this.device(tx, hash);
      if (device.revision !== value.revision) throw conflict();
      if (value.state === 'active' && !device.objectKey)
        throw new ApiError(
          400,
          'INVALID_HEARTBEAT',
          'Upload a complete snapshot first.',
        );
      const now = new Date(this.clock()).toISOString();
      await tx.put(
        device.pk,
        {
          ...device,
          name: value.deviceName,
          status: value.state,
          lastContactAt: now,
          lastVerifiedAt:
            value.state === 'active' ? now : (device.lastVerifiedAt ?? null),
        },
        device.sk,
      );
    });
  }
  private async retire(
    tx: Transaction,
    owner: Row,
    device: Row,
    remove: boolean,
  ) {
    await tx.delete(`TOKEN#${device.credentialHash}`);
    await tx.put(owner.pk, {
      ...owner,
      activeDevice:
        owner.activeDevice === device.id ? null : (owner.activeDevice ?? null),
    });
    if (remove) {
      if (device.objectKey) await this.garbage(tx, device.objectKey);
      await tx.delete(device.pk, device.sk);
    } else await tx.put(device.pk, { ...device, status: 'revoked' }, device.sk);
  }
  async revoke(hash: string, id: string) {
    await this.run(async (tx) => {
      const { owner, device } = await this.owned(tx, hash, id);
      await this.retire(tx, owner, device, false);
    });
  }
  async delete(hash: string, id: string) {
    await this.run(async (tx) => {
      const { owner, device } = await this.owned(tx, hash, id);
      await this.retire(tx, owner, device, true);
    });
  }
  async disconnect(hash: string) {
    await this.run(async (tx) => {
      const { owner, device } = await this.device(tx, hash);
      await this.retire(tx, owner, device, false);
    });
  }
  /** Small two-account pilot: paginated object registry, no scan of user data. Never delete live objects.
   * Garbage tombstones are retried for a day to catch late completion of interrupted S3 writes. */
  async cleanup() {
    const objects = await this.backend.query('OBJECTS', 'snapshots/');
    let deleted = 0;
    for (const candidate of objects
      .filter((row) => row.state !== 'live' && row.dueAt <= this.clock())
      .sort((a, b) => a.dueAt - b.dueAt)
      .slice(0, 50)) {
      const claim = await this.run(async (tx) => {
        const row = await tx.get('OBJECTS', candidate.sk);
        if (!row || row.state === 'live' || row.dueAt > this.clock())
          return null;
        const next = {
          ...row,
          state: 'garbage',
          retiredAt: row.retiredAt ?? this.clock(),
          dueAt: this.clock() + 15 * 60_000,
        };
        await tx.put('OBJECTS', next, row.sk);
        return next;
      });
      if (!claim) continue;
      await this.objects.delete(candidate.sk);
      deleted++;
      if (this.clock() - claim.retiredAt > DAY)
        await this.run(async (tx) => {
          const row = await tx.get('OBJECTS', candidate.sk);
          if (row?.state === 'garbage')
            await tx.delete('OBJECTS', candidate.sk);
        });
    }
    return { deleted };
  }
}
