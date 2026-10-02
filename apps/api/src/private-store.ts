import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Snapshot } from '@tabmirror/contracts';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export interface DeviceView {
  id: string;
  name: string;
  status: 'active' | 'paused' | 'revoked';
  revision: number;
  receivedAt: string | null;
  lastContactAt: string | null;
  lastVerifiedAt: string | null;
  lastContentChangedAt: string | null;
}
export interface PrivateEnvelope {
  device: DeviceView;
  receivedAt: string | null;
  lastContactAt: string | null;
  lastVerifiedAt: string | null;
  lastContentChangedAt: string | null;
  snapshot: Snapshot | null;
}
export interface Heartbeat {
  revision: number;
  state: 'active' | 'paused';
  checkedAt?: string;
  deviceName: string;
}
/** Implementations must atomically authenticate and apply each operation, including reads.
 * A cloud implementation must preserve these semantics across its metadata/object stores.
 * Token arguments are SHA-256 digests; raw credentials never enter storage.
 */
type Result<T> = T | Promise<T>;
export interface PrivateStore {
  status(tokenHash: string): Result<{ revision: number }>;
  upload(
    tokenHash: string,
    raw: string,
    snapshot: Snapshot,
  ): Result<{ revision: number; receivedAt: string }>;
  heartbeat(tokenHash: string, value: Heartbeat): Result<void>;
  disconnect(tokenHash: string): Result<void>;
  devices(tokenHash: string): Result<DeviceView[]>;
  snapshot(tokenHash: string, deviceId: string): Result<PrivateEnvelope>;
  revoke(tokenHash: string, deviceId: string): Result<void>;
  delete(tokenHash: string, deviceId: string): Result<void>;
  health(): Result<void>;
}
export function newCredential() {
  return randomBytes(32).toString('hex');
}
export function newId() {
  return randomUUID();
}
