import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const entry = resolve('apps/api/dist/auth-main.js');
const directory = await mkdtemp(join(tmpdir(), 'tabmirror-auth-built-'));
const probe = createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const env = {
  ...process.env,
  NODE_ENV: 'development',
  APP_MODE: 'local',
  PRIVATE_API_PORT: String(port),
  WEB_ORIGIN: 'http://127.0.0.1:4338',
  GOOGLE_ALLOWED_EMAILS: 'daniel@example.test',
  GOOGLE_CLIENT_ID: '',
  GOOGLE_CLIENT_SECRET: '',
};
const blocked = spawnSync(process.execPath, [entry], {
  cwd: directory,
  env: { ...env, NODE_ENV: 'production' },
  encoding: 'utf8',
  timeout: 5000,
});
assert.equal(blocked.status, 1);
assert.match(blocked.stderr, /local-development only/);
const child = spawn(process.execPath, [entry], {
  cwd: directory,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
const exited = once(child, 'exit');
let output = '';
child.stdout.on('data', (data) => {
  output += data;
});
child.stderr.on('data', (data) => {
  output += data;
});
try {
  for (
    let i = 0;
    i < 50 && !output.includes('Authenticated local API ready');
    i++
  ) {
    if (child.exitCode !== null) throw Error(`Bootstrap failed: ${output}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(output.includes('Authenticated local API ready'));
  const base = `http://127.0.0.1:${port}`;
  assert.deepEqual(await fetch(`${base}/api/session`).then((r) => r.json()), {
    authenticated: false,
    googleConfigured: false,
  });
  assert.equal((await fetch(`${base}/api/devices`)).status, 401);
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { Origin: env.WEB_ORIGIN },
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'GOOGLE_NOT_CONFIGURED');
  console.log(
    'PASS: bundled auth API starts safely without Google credentials, blocks private access, and refuses production SQLite bootstrap.',
  );
} finally {
  child.kill('SIGTERM');
  await exited;
  await rm(directory, { recursive: true, force: true });
}
