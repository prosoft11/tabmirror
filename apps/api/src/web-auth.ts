import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { parseStrictJson } from '@tabmirror/contracts';
import { ApiError, digest, newCredential } from './private-store.js';
import { type AuthStore, YEAR, LOGIN_TTL } from './auth-contract.js';
import type { IdentityProvider } from './google-oidc.js';
import { body } from './request-body.js';
export interface WebAuthOptions {
  origin: string;
  local: boolean;
  allowedEmails: string[];
  provider?: () => Promise<IdentityProvider>;
  clientIp?: (req: IncomingMessage) => string;
}
export interface AuthRoutes {
  handle(
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
  ): Promise<boolean>;
  viewer(
    req: IncomingMessage,
    res: ServerResponse,
    mutation: boolean,
  ): Promise<string>;
}
function cookie(req: IncomingMessage, name: string) {
  const matches = (req.headers.cookie ?? '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.startsWith(`${name}=`));
  const value = matches.length === 1 ? matches[0]!.slice(name.length + 1) : '';
  return /^[a-f0-9]{64}$/.test(value) ? value : undefined;
}
export const csrfToken = (token: string) => digest(`csrf:${token}`);
function equal(a: string, b: string) {
  return (
    Buffer.byteLength(a) === Buffer.byteLength(b) &&
    timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}
export class WebAuth implements AuthRoutes {
  readonly sessionCookie: string;
  readonly loginCookie: string;
  constructor(
    private store: AuthStore,
    private options: WebAuthOptions,
  ) {
    const url = new URL(options.origin);
    if (
      url.origin !== options.origin ||
      (options.local
        ? url.protocol !== 'http:' || url.hostname !== '127.0.0.1'
        : url.protocol !== 'https:')
    )
      throw new Error(
        'Auth requires an exact HTTPS origin, or explicit HTTP loopback development.',
      );
    this.sessionCookie = options.local
      ? 'tabmirror_local_session'
      : '__Host-tabmirror_session';
    this.loginCookie = options.local
      ? 'tabmirror_local_login'
      : '__Host-tabmirror_login';
  }
  private initialization?: Promise<void>;
  private initialize() {
    return (this.initialization ??= Promise.resolve()
      .then(() => this.store.configureAllowlist(this.options.allowedEmails))
      .catch((error) => {
        this.initialization = undefined;
        throw error;
      }));
  }
  private setCookie(
    res: ServerResponse,
    name: string,
    value: string,
    maxAge: number,
  ) {
    res.appendHeader(
      'Set-Cookie',
      `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${this.options.local ? '' : '; Secure'}`,
    );
  }
  private origin(req: IncomingMessage) {
    if (req.headers.origin !== this.options.origin)
      throw new ApiError(403, 'CSRF_FAILED', 'Reload this page and try again.');
  }
  async viewer(req: IncomingMessage, res: ServerResponse, mutation: boolean) {
    await this.initialize();
    const token = cookie(req, this.sessionCookie);
    if (!token) throw new ApiError(401, 'SIGNED_OUT', 'Please sign in.');
    if (mutation) {
      this.origin(req);
      if (!equal(String(req.headers['x-csrf-token'] ?? ''), csrfToken(token)))
        throw new ApiError(
          403,
          'CSRF_FAILED',
          'Reload this page and try again.',
        );
    }
    const session = await this.store.session(digest(token));
    if (session.renewed)
      this.setCookie(res, this.sessionCookie, token, YEAR / 1000);
    return digest(token);
  }
  async handle(req: IncomingMessage, res: ServerResponse, path: string) {
    await this.initialize();
    const send = (status: number, value: unknown) => {
      res.writeHead(status);
      res.end(JSON.stringify(value));
      return true;
    };
    const ip = digest(
      this.options.clientIp?.(req) ?? req.socket.remoteAddress ?? 'unknown',
    );
    if (path === '/api/session' && req.method === 'GET') {
      const token = cookie(req, this.sessionCookie);
      if (token) {
        try {
          const hash = await this.viewer(req, res, false),
            session = await this.store.session(hash);
          return send(200, {
            authenticated: true,
            email: session.email,
            csrfToken: csrfToken(token),
            expiresAt: session.expiresAt,
          });
        } catch (error) {
          if (!(error instanceof ApiError && error.status === 401)) throw error;
        }
      }
      return send(200, {
        authenticated: false,
        googleConfigured: !!this.options.provider,
      });
    }
    if (path === '/api/auth/login' && req.method === 'POST') {
      this.origin(req);
      await this.store.throttle(`login:${ip}`, 10, LOGIN_TTL);
      if (!this.options.provider)
        throw new ApiError(
          503,
          'GOOGLE_NOT_CONFIGURED',
          'Google sign-in is awaiting OAuth client configuration.',
        );
      const provider = await this.options.provider();
      const secret = newCredential();
      const authorizationUrl = await provider.authorizationUrl(secret);
      await this.store.beginLogin(digest(secret));
      this.setCookie(res, this.loginCookie, secret, LOGIN_TTL / 1000);
      return send(200, { authorizationUrl });
    }
    if (path === '/api/auth/callback' && req.method === 'GET') {
      this.setCookie(res, this.loginCookie, '', 0);
      try {
        const secret = cookie(req, this.loginCookie);
        if (!secret || !this.options.provider) throw new Error('No login');
        await this.store.consumeLogin(digest(secret));
        const identity = await (
          await this.options.provider()
        ).exchange(new URL(req.url!, this.options.origin), secret);
        const previous = cookie(req, this.sessionCookie);
        const session = await this.store.signIn(
          identity,
          this.options.allowedEmails,
          previous ? digest(previous) : undefined,
        );
        this.setCookie(res, this.sessionCookie, session.token, YEAR / 1000);
        res.writeHead(303, { Location: '/pair' });
      } catch {
        res.writeHead(303, { Location: '/?auth=failed' });
      }
      res.end();
      return true;
    }
    if (path === '/api/auth/logout' && req.method === 'POST') {
      const hash = await this.viewer(req, res, true);
      await this.store.logout(hash);
      this.setCookie(res, this.sessionCookie, '', 0);
      return send(200, { ok: true });
    }
    if (path.startsWith('/api/pairings/') && req.method === 'POST') {
      const action = path.slice('/api/pairings/'.length);
      let hash: string | undefined;
      if (['lookup', 'approve', 'deny'].includes(action)) {
        hash = await this.viewer(req, res, true);
        await this.store.throttle(`approve-session:${hash}`, 5, LOGIN_TTL);
        await this.store.throttle(`approve-ip:${ip}`, 20, LOGIN_TTL);
      } else if (action === 'start')
        await this.store.throttle(`start:${ip}`, 5, LOGIN_TTL);
      else if (action === 'redeem')
        await this.store.throttle(`redeem-ip:${ip}`, 60, 60_000);
      else return false;
      const value = parseStrictJson(await body(req, 4096)) as Record<
        string,
        unknown
      >;
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new ApiError(400, 'INVALID_PAIRING', 'Invalid pairing request.');
      const keys =
        action === 'start'
          ? ['challenge', 'name']
          : action === 'redeem'
            ? ['id', 'verifier']
            : action === 'lookup'
              ? ['code']
              : ['id', 'code'];
      if (Object.keys(value).some((k) => !keys.includes(k)))
        throw new ApiError(400, 'INVALID_PAIRING', 'Invalid pairing request.');
      const hex = (v: unknown) =>
        typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
      const id = (v: unknown) =>
        typeof v === 'string' && /^[a-f0-9-]{36}$/.test(v);
      if (
        action === 'start' &&
        hex(value.challenge) &&
        typeof value.name === 'string' &&
        value.name.trim() &&
        value.name.length <= 80
      ) {
        const pair = await this.store.createPairing(
          value.challenge as string,
          value.name.trim(),
        );
        return send(201, {
          ...pair,
          verificationUri: `${this.options.origin}/pair`,
          interval: 5,
        });
      }
      if (action === 'redeem' && id(value.id) && hex(value.verifier)) {
        await this.store.throttle(`redeem:${value.id}`, 12, 60_000);
        return send(
          200,
          await this.store.redeemPairing(
            String(value.id),
            String(value.verifier),
          ),
        );
      }
      if (
        hash &&
        typeof value.code === 'string' &&
        /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(value.code)
      ) {
        if (action === 'lookup')
          return send(200, await this.store.lookupPairing(hash, value.code));
        if (id(value.id)) {
          await this.store.approvePairing(
            hash,
            value.code,
            String(value.id),
            action === 'approve',
          );
          return send(200, { ok: true });
        }
      }
      throw new ApiError(
        400,
        'INVALID_PAIRING',
        'Check the code and device name.',
      );
    }
    return false;
  }
}
