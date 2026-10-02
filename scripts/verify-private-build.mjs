import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const entry = resolve('apps/api/dist/private-main.js');
const directory = await mkdtemp(join(tmpdir(), 'tabmirror-private-built-'));
const fixture = JSON.parse(
  await readFile('packages/contracts/examples/mixed.json', 'utf8'),
);
const probe = createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const environment = {
  ...process.env,
  NODE_ENV: 'development',
  APP_MODE: 'local',
  PRIVATE_API_PORT: String(port),
};
const blocked = spawnSync(process.execPath, [entry], {
  cwd: directory,
  env: { ...environment, NODE_ENV: 'production' },
  encoding: 'utf8',
  timeout: 5000,
});
assert.equal(blocked.status, 1);
assert.match(blocked.stderr, /local-development only/);
let child, exited;
async function start() {
  child = spawn(process.execPath, [entry], {
    cwd: directory,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  exited = once(child, 'exit');
  let output = '';
  child.stdout.on('data', (data) => {
    output += data;
  });
  child.stderr.on('data', (data) => {
    output += data;
  });
  for (let attempt = 0; attempt < 50; attempt++) {
    if (child.exitCode !== null)
      throw new Error(`Private API exited: ${output}`);
    if (output.includes('Private API listening')) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Private API did not become ready.');
}
async function stop(signal = 'SIGTERM') {
  child.kill(signal);
  await exited;
}
const request = (token, path, method = 'GET', body) =>
  fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
try {
  await start();
  const connectionFile = join(directory, '.local/private-connection.json');
  const credentials = JSON.parse(await readFile(connectionFile, 'utf8'));
  const { deviceToken, viewerToken, deviceId } = credentials;
  assert.equal(
    (await request(deviceToken, '/api/device/snapshot', 'PUT', fixture)).status,
    200,
  );
  // Abrupt process death after an acknowledged commit must not lose the snapshot or rotate credentials.
  await stop('SIGKILL');
  await start();
  assert.deepEqual(
    JSON.parse(await readFile(connectionFile, 'utf8')),
    credentials,
  );
  const snapshotPath = `/api/devices/${deviceId}/snapshot`;
  assert.deepEqual(
    (await request(viewerToken, snapshotPath).then((r) => r.json())).snapshot,
    fixture,
  );
  assert.equal(
    (await request(viewerToken, `/api/devices/${deviceId}`, 'DELETE')).status,
    204,
  );
  await stop();
  await start();
  assert.equal((await request(viewerToken, snapshotPath)).status, 404);
  assert.equal((await request(deviceToken, '/api/device/status')).status, 401);
  console.log(
    'PASS: bundled private API retains acknowledged snapshot/credentials after SIGKILL; deletion persists; production bootstrap refuses to start.',
  );
} finally {
  if (child && child.exitCode === null && child.signalCode === null)
    await stop();
  await rm(directory, { recursive: true, force: true });
}
