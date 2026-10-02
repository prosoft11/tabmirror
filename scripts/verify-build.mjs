import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import assert from 'node:assert/strict';
const entry = 'apps/api/dist/main.js';
const environment = {
  ...process.env,
  NODE_ENV: 'development',
  APP_MODE: 'local',
  AUTH_MODE: 'mock',
  STORAGE_DRIVER: 'memory',
  API_HOST: '127.0.0.1',
  WEB_PORT: '4317',
};
const blocked = spawnSync(process.execPath, [entry], {
  env: { ...environment, NODE_ENV: 'production' },
  encoding: 'utf8',
  timeout: 5000,
});
assert.equal(blocked.status, 1);
assert.match(
  blocked.stderr,
  /Production authentication and storage are not implemented/,
);
const probe = createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const child = spawn(process.execPath, [entry], {
  env: { ...environment, API_PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (data) => {
  output += data;
});
child.stderr.on('data', (data) => {
  output += data;
});
const exited = once(child, 'exit');
try {
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    if (child.exitCode !== null)
      throw new Error(`Bundled API exited: ${output}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      /* Waiting for startup. */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, `Bundled API did not start: ${output}`);
  const response = await fetch(
    `http://127.0.0.1:${port}/api/devices/mixed/snapshot`,
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).snapshot.windows.length, 2);
  console.log(
    'PASS: built API serves validated fixture; production startup refuses mock adapters.',
  );
} finally {
  child.kill('SIGTERM');
  await exited;
}
