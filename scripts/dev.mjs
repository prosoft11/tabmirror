import { spawn } from 'node:child_process';
import { once } from 'node:events';
const children = [];
function start(args) {
  const child = spawn(process.execPath, args, {
    stdio: 'inherit',
    env: process.env,
  });
  children.push(child);
  return child;
}
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());
const privateMode = process.argv.includes('--auth');
if (privateMode) process.env.API_PORT = process.env.PRIVATE_API_PORT || '4319';
const api = start([
  '--import',
  'tsx',
  privateMode ? 'apps/api/src/auth-main.ts' : 'apps/api/src/main.ts',
]);
api.on('exit', (code) => stop(code ?? 1));
// Wait for a healthy API before presenting the web server.
let ready = false;
for (let attempt = 0; attempt < 50 && !stopping; attempt++) {
  try {
    const response = await fetch(
      `http://127.0.0.1:${process.env.API_PORT || 4318}/api/health`,
      { signal: AbortSignal.timeout(500) },
    );
    if (response.ok) {
      ready = true;
      break;
    }
  } catch {
    /* API may still be starting. */
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
}
if (!ready) {
  console.error('Local API did not become healthy.');
  stop(1);
} else {
  const web = start([
    'node_modules/vite/bin/vite.js',
    '--config',
    'apps/web/vite.config.ts',
  ]);
  web.on('exit', (code) => stop(code ?? 1));
  await once(web, 'exit');
}
