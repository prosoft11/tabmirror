import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  mkdir,
  readFile,
  writeFile,
  copyFile,
  access,
  readdir,
  mkdtemp,
  rm,
} from 'node:fs/promises';
const settings = JSON.parse(
  await readFile('infra/production-settings.json', 'utf8'),
);
if (
  settings.accountId !== '400745793130' ||
  settings.hostname !== 'tabs.portuit.com' ||
  settings.region !== 'us-west-2'
)
  throw Error('Production target mismatch');
const origin = `https://${settings.hostname}`;
const identityPath = 'infra/extension-identity.json';
try {
  await access(identityPath);
} catch {
  // Only a public identity is retained. This is an unpacked extension, not a CRX signing key.
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = publicKey
    .export({ type: 'spki', format: 'der' })
    .toString('base64');
  const id = createHash('sha256')
    .update(Buffer.from(key, 'base64'))
    .digest('hex')
    .slice(0, 32)
    .replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
  await writeFile(identityPath, JSON.stringify({ key, id }, null, 2) + '\n', {
    flag: 'wx',
  });
}
const identity = JSON.parse(await readFile(identityPath, 'utf8'));
const base = 'artifacts/production';
await mkdir(`${base}/api`, { recursive: true });
await mkdir(`${base}/extension`, { recursive: true });
await build({
  entryPoints: ['apps/api/src/cloud/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  mainFields: ['module', 'main'],
  outfile: `${base}/api/index.js`,
});
// Import the standalone bundle outside this repository so missing dependencies
// cannot be accidentally supplied by the development node_modules directory.
const startupDir = await mkdtemp(join(tmpdir(), 'tabmirror-startup-'));
try {
  const bundle = join(startupDir, 'index.cjs');
  await copyFile(`${base}/api/index.js`, bundle);
  execFileSync(
    process.execPath,
    [
      '-e',
      'if (typeof require(process.argv[1]).handler !== "function") process.exit(1)',
      bundle,
    ],
    { cwd: startupDir, stdio: 'pipe' },
  );
} finally {
  await rm(startupDir, { recursive: true, force: true });
}
for (const entry of ['background', 'popup'])
  await build({
    entryPoints: [`apps/extension/src/${entry}.ts`],
    bundle: true,
    platform: 'browser',
    target: 'chrome120',
    minifySyntax: true,
    format: 'esm',
    outfile: `${base}/extension/${entry}.js`,
    define: {
      TABMIRROR_API_ORIGIN: JSON.stringify(origin),
      TABMIRROR_WEB_ORIGIN: JSON.stringify(origin),
    },
  });
const manifest = JSON.parse(
  await readFile('apps/extension/manifest.json', 'utf8'),
);
Object.assign(manifest, {
  name: 'TabMirror',
  description: 'Your private Chrome tabs, organized by window and group.',
  key: identity.key,
  host_permissions: [`${origin}/*`],
});
await writeFile(
  `${base}/extension/manifest.json`,
  JSON.stringify(manifest, null, 2) + '\n',
);
let popup = await readFile('apps/extension/popup.html', 'utf8');
popup = popup
  .replace('LOCAL PROTOTYPE', 'PRIVATE SYNC')
  .replace(
    /<aside id="connection-environment">[\s\S]*?<\/aside>/,
    '<aside id="connection-environment">Production: tabs.portuit.com. Pair this desktop Chrome profile at https://tabs.portuit.com/pair. On your phone, sign in to the same account to view its tabs.</aside>',
  )
  .replace(
    /<details id="manual">[\s\S]*?<\/details>/,
    '<details id="manual" hidden><summary>Developer connection</summary><label id="token-label"><input id="token" type="password" /></label><button id="connect" type="submit" hidden>Connect</button></details>',
  );
await writeFile(`${base}/extension/popup.html`, popup);
for (const file of ['popup.css', 'tabmirror.png'])
  await copyFile(`apps/extension/${file}`, `${base}/extension/${file}`);
await mkdir('apps/web/public', { recursive: true });
await copyFile('apps/extension/tabmirror.png', 'apps/web/public/tabmirror.png');
await viteBuild({
  configFile: 'apps/web/vite.config.ts',
  build: { outDir: '../../artifacts/production/web', emptyOutDir: true },
  define: { 'import.meta.env.VITE_PRODUCTION_PRIVATE': 'true' },
});
const files = {};
async function hashTree(relative) {
  for (const entry of await readdir(`${base}/${relative}`, {
    withFileTypes: true,
  })) {
    const path = `${relative}/${entry.name}`;
    if (entry.isDirectory()) await hashTree(path);
    else if (entry.isFile())
      files[path] = createHash('sha256')
        .update(await readFile(`${base}/${path}`))
        .digest('hex');
    else throw Error('Unexpected release entry');
  }
}
for (const folder of ['api', 'extension', 'web']) await hashTree(folder);
const releaseId = `release-${createHash('sha256')
  .update(JSON.stringify(Object.entries(files).sort()))
  .digest('hex')
  .slice(0, 20)}`;
await writeFile(
  `${base}/release.json`,
  JSON.stringify(
    {
      builtAt: new Date().toISOString(),
      origin,
      account: settings.accountId,
      region: settings.region,
      extensionId: identity.id,
      releaseId,
      sha256: files,
    },
    null,
    2,
  ) + '\n',
);
console.log('Production artifacts prepared locally; no AWS resources changed.');
