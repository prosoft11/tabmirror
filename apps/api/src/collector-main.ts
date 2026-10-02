import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createCollector } from './collector';
if (process.env.NODE_ENV !== 'development' || process.env.APP_MODE !== 'local')
  throw new Error(
    'Collector is development-only. Set NODE_ENV=development APP_MODE=local.',
  );
const token = randomBytes(32).toString('hex');
const server = createCollector(token);
server.on('error', () => {
  console.error('Collector cannot bind port 4319.');
  process.exitCode = 1;
});
server.listen(4319, '127.0.0.1', () => {
  void (async () => {
    await mkdir('.local', { recursive: true, mode: 0o700 });
    await writeFile(
      '.local/extension-connection.json',
      JSON.stringify({ endpoint: 'http://127.0.0.1:4319', token }, null, 2) +
        '\n',
      { mode: 0o600 },
    );
    console.info(
      'Local collector ready on 127.0.0.1:4319. Copy the token from .local/extension-connection.json into the extension. Snapshots stay in memory; restart rotates the token.',
    );
  })().catch(() => {
    console.error('Cannot write local connection file.');
    server.close();
    process.exitCode = 1;
  });
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => server.close());
