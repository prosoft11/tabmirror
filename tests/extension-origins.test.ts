import { expect, it } from 'vitest';
import { createHash, createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { extensionOrigins } from '../apps/api/src/cloud/extension-origins';
const legacy = 'biaficlopbhcnonckljljbmcfmceaaod';
const store = 'apfpbigapofnikmebmmapdekfkkigmlm';
it('allows the exact Store and existing unpacked origins while rejecting lookalikes', () => {
  const allowed = extensionOrigins(`${legacy},${store}`);
  for (const id of [legacy, store])
    expect(allowed.test(`chrome-extension://${id}`)).toBe(true);
  for (const origin of [
    `chrome-extension://${store}.evil.test`,
    `https://${store}`,
    `chrome-extension://${'a'.repeat(32)}`,
    `chrome-extension://${store}/`,
  ])
    expect(allowed.test(origin)).toBe(false);
  for (const config of ['', `${store},`, `${store}\n`, '.*'])
    expect(() => extensionOrigins(config)).toThrow();
});
it('pins the Store public key to the supplied Chrome item ID', () => {
  const identity = JSON.parse(
    readFileSync('infra/store-extension-identity.json', 'utf8'),
  );
  const der = Buffer.from(identity.key, 'base64');
  createPublicKey({ key: der, format: 'der', type: 'spki' });
  const id = createHash('sha256')
    .update(der)
    .digest('hex')
    .slice(0, 32)
    .replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
  expect(id).toBe(store);
  expect(identity.id).toBe(id);
});
