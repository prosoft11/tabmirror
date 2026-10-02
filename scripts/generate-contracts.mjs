import { readFile, mkdir, writeFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import standaloneCode from 'ajv/dist/standalone/index.js';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { compile } from 'json-schema-to-typescript';
const schema = JSON.parse(
  await readFile(
    new URL('../packages/contracts/snapshot.schema.json', import.meta.url),
    'utf8',
  ),
);
const output = new URL('../packages/contracts/generated/', import.meta.url);
await mkdir(output, { recursive: true });
const ajv = new Ajv2020({
  strict: true,
  allErrors: false,
  code: { source: true },
});
addFormats(ajv);
const validate = ajv.compile(schema);
await build({
  stdin: {
    contents: standaloneCode(ajv, validate),
    resolveDir: fileURLToPath(output),
    sourcefile: 'validate.cjs',
  },
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  outfile: fileURLToPath(new URL('validate.js', output)),
});
await writeFile(
  new URL('validate.d.ts', output),
  "import type { Snapshot } from './snapshot';\ndeclare const validate: { (value: unknown): value is Snapshot; errors?: { keyword: string }[] | null };\nexport default validate;\n",
);
await writeFile(
  new URL('snapshot.d.ts', output),
  await compile({ ...schema, title: 'Snapshot' }, 'Snapshot', {
    bannerComment: '// Generated from snapshot.schema.json. Do not edit.',
    additionalProperties: false,
  }),
);
console.log('Generated schema types and CSP-safe standalone validator.');
