import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createPrivateApi } from './private-api.js';
import { SqlitePrivateStore } from './sqlite-store.js';
// Provisioning is intentionally restricted to local development until Google login/pairing ships.
if (
  process.env.NODE_ENV !== 'development' ||
  process.env.APP_MODE !== 'local'
) {
  throw new Error(
    'Private API bootstrap is local-development only. Production identity provisioning is not implemented.',
  );
}
const port = Number(process.env.PRIVATE_API_PORT ?? 4319);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535)
  throw new Error('Invalid private API port.');
const endpoint = `http://127.0.0.1:${port}`;
process.umask(0o077);
mkdirSync('.local', { recursive: true, mode: 0o700 });
const store = new SqlitePrivateStore('.local/private.sqlite');
const connectionPath = '.local/private-connection.json';
try {
  JSON.parse(readFileSync(connectionPath, 'utf8'));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  const connection = store.provision('local-daniel');
  writeFileSync(
    connectionPath,
    JSON.stringify({ endpoint, ...connection }, null, 2),
    { mode: 0o600, flag: 'wx' },
  );
}
const server = createPrivateApi(store, {
  allowedHosts: [`127.0.0.1:${port}`],
  viewerOrigin: 'http://127.0.0.1:4317',
  extensionOrigin: /^chrome-extension:\/\/[a-p]{32}$/,
  log: (event) => console.log(JSON.stringify(event)),
});
server.listen(port, '127.0.0.1', () =>
  console.log(
    `Private API listening on ${endpoint}. Credentials: .local/private-connection.json (keep private).`,
  ),
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () =>
    server.close(() => {
      store.close();
      process.exit(0);
    }),
  );
