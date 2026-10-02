import { mkdirSync } from 'node:fs';
import { SqliteAuthStore } from './auth-store.js';
import { createPrivateApi } from './private-api.js';
import { WebAuth } from './web-auth.js';
import { GoogleOidc, type IdentityProvider } from './google-oidc.js';
// Local adapter only. Cloud deployment must supply its own durable store and HTTPS entry point.
if (process.env.NODE_ENV !== 'development' || process.env.APP_MODE !== 'local')
  throw new Error('Authenticated SQLite bootstrap is local-development only.');
const port = Number(process.env.PRIVATE_API_PORT ?? 4319);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535)
  throw new Error('Invalid private API port.');
const origin = process.env.WEB_ORIGIN ?? 'http://127.0.0.1:4317';
const emails = (process.env.GOOGLE_ALLOWED_EMAILS ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
if (
  !emails.length ||
  emails.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
)
  throw new Error('Explicit Google email allowlist required.');
const clientId = process.env.GOOGLE_CLIENT_ID,
  clientSecret = process.env.GOOGLE_CLIENT_SECRET;
if (!!clientId !== !!clientSecret)
  throw new Error('Set both Google client ID and secret, or leave both empty.');
process.umask(0o077);
mkdirSync('.local', { recursive: true, mode: 0o700 });
const store = new SqliteAuthStore('.local/private.sqlite');
let discovery: Promise<IdentityProvider> | undefined;
const provider =
  clientId && clientSecret
    ? () => {
        discovery ??= GoogleOidc.discover(
          clientId,
          clientSecret,
          `${origin}/api/auth/callback`,
        ).catch((error) => {
          discovery = undefined;
          throw error;
        });
        return discovery;
      }
    : undefined;
const auth = new WebAuth(store, {
  origin,
  local: true,
  allowedEmails: emails,
  provider,
});
const server = createPrivateApi(store, {
  allowedHosts: [`127.0.0.1:${port}`, new URL(origin).host],
  viewerOrigin: origin,
  extensionOrigin: /^chrome-extension:\/\/[a-p]{32}$/,
  auth,
  log: (event) => console.log(JSON.stringify(event)),
});
server.listen(port, '127.0.0.1', () =>
  console.log(
    `Authenticated local API ready on port ${port}. Google sign-in ${provider ? 'configured' : 'awaiting OAuth client configuration'}.`,
  ),
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () =>
    server.close(() => {
      store.close();
      process.exit(0);
    }),
  );
