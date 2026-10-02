import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import { mkdir, copyFile } from 'node:fs/promises';
await build({
  entryPoints: ['apps/api/src/main.ts'],
  bundle: true,
  platform: 'node',
  mainFields: ['module', 'main'],
  target: 'node22',
  format: 'esm',
  outfile: 'apps/api/dist/main.js',
});
await build({
  entryPoints: ['apps/api/src/private-main.ts'],
  bundle: true,
  platform: 'node',
  mainFields: ['module', 'main'],
  target: 'node22',
  format: 'esm',
  outfile: 'apps/api/dist/private-main.js',
});
await build({
  entryPoints: ['apps/api/src/auth-main.ts'],
  bundle: true,
  platform: 'node',
  mainFields: ['module', 'main'],
  target: 'node22',
  format: 'esm',
  outfile: 'apps/api/dist/auth-main.js',
});
await build({
  entryPoints: ['apps/extension/src/background.ts'],
  bundle: true,
  platform: 'browser',
  target: 'chrome120',
  format: 'esm',
  outfile: 'apps/extension/dist/background.js',
});
await build({
  entryPoints: ['apps/extension/src/popup.ts'],
  bundle: true,
  platform: 'browser',
  target: 'chrome120',
  format: 'esm',
  outfile: 'apps/extension/dist/popup.js',
});
await mkdir('apps/extension/dist', { recursive: true });
for (const file of ['popup.html', 'popup.css', 'tabmirror.png'])
  await copyFile(`apps/extension/${file}`, `apps/extension/dist/${file}`);
await copyFile(
  'apps/extension/manifest.json',
  'apps/extension/dist/manifest.json',
);
await mkdir('apps/web/public', { recursive: true });
await copyFile('apps/extension/tabmirror.png', 'apps/web/public/tabmirror.png');
await viteBuild({ configFile: 'apps/web/vite.config.ts' });
