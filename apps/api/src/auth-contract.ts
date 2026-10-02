import type { PrivateStore } from './private-store.js';
export const DAY = 86_400_000;
export const YEAR = 365 * DAY;
export const LOGIN_TTL = 10 * 60_000;
export interface GoogleIdentity {
  subject: string;
  email: string;
  emailVerified: boolean;
}
export interface Session {
  email: string;
  expiresAt: number;
  renewed: boolean;
}
type Result<T> = T | Promise<T>;
export interface PairingView {
  id: string;
  code: string;
  name: string;
  expiresAt: number;
}
export type Redemption =
  | { status: 'pending' }
  | { status: 'paired'; token: string; deviceId: string; name: string };
/** Implementations authenticate and mutate atomically; rejected pairing attempts must still commit. */
export interface AuthStore extends PrivateStore {
  configureAllowlist(emails: string[]): Result<void>;
  throttle(key: string, maximum: number, windowMs: number): Result<void>;
  beginLogin(hash: string): Result<void>;
  consumeLogin(hash: string): Result<void>;
  signIn(
    identity: GoogleIdentity,
    allowedEmails: string[],
    previousHash?: string,
  ): Result<{ token: string; expiresAt: number }>;
  session(hash: string): Result<Session>;
  logout(hash: string): Result<void>;
  createPairing(challenge: string, name: string): Result<PairingView>;
  lookupPairing(hash: string, code: string): Result<PairingView>;
  approvePairing(
    hash: string,
    code: string,
    id: string,
    approve: boolean,
  ): Result<void>;
  redeemPairing(id: string, verifier: string): Result<Redemption>;
}
