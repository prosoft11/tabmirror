// This script is deliberately restricted to the local emulator and uses synthetic credentials only.
import assert from 'node:assert/strict';
import {
  DynamoDBClient,
  CreateTableCommand,
  DeleteTableCommand,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoBackend } from '../apps/api/src/cloud/transactions';
import { CloudStore } from '../apps/api/src/cloud/store';
import { MemoryObjects } from '../tests/helpers/cloud-memory';
import { digest } from '../apps/api/src/private-store';
import { makeFixture } from '../packages/contracts/src/fixtures';
const client = new DynamoDBClient({
  region: 'us-west-2',
  endpoint: 'http://127.0.0.1:8432',
  credentials: { accessKeyId: 'LOCALONLY', secretAccessKey: 'LOCALONLY' },
  maxAttempts: 2,
});
const table = `TabMirrorLocal${Date.now()}`;
await client.send(
  new CreateTableCommand({
    TableName: table,
    KeySchema: [
      { AttributeName: 'pk', KeyType: 'HASH' },
      { AttributeName: 'sk', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'pk', AttributeType: 'S' },
      { AttributeName: 'sk', AttributeType: 'S' },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  }),
);
try {
  const store = new CloudStore(
    new DynamoBackend(
      DynamoDBDocumentClient.from(client, {
        marshallOptions: { removeUndefinedValues: true },
      }),
      table,
    ),
    new MemoryObjects(),
  );
  await store.configureAllowlist(['local@example.test']);
  const user = await store.signIn(
    { subject: 'local', email: 'local@example.test', emailVerified: true },
    ['local@example.test'],
  );
  const viewer = digest(user.token),
    verifier = 'a'.repeat(64),
    pair = await store.createPairing(digest(verifier), 'Local DynamoDB');
  await store.approvePairing(viewer, pair.code, pair.id, true);
  const paired = await store.redeemPairing(pair.id, verifier);
  assert.equal(paired.status, 'paired');
  if (paired.status !== 'paired') throw Error('Pairing failed');
  const hash = digest(paired.token),
    base = makeFixture('mixed');
  await Promise.allSettled(
    [0, 1, 2].map((n) => {
      const s = { ...base, revision: base.revision + n };
      return store.upload(hash, JSON.stringify(s), s);
    }),
  );
  const snapshot = await store.snapshot(viewer, paired.deviceId);
  assert.equal(snapshot.snapshot?.revision, base.revision + 2);
  assert.equal((await store.devices(viewer)).length, 1);
  await store.revoke(viewer, paired.deviceId);
  await assert.rejects(store.status(hash), { status: 401 });
  assert.equal(
    (await store.snapshot(viewer, paired.deviceId)).device.status,
    'revoked',
  );
  await store.delete(viewer, paired.deviceId);
  await store.cleanup();
  assert.equal((await store.devices(viewer)).length, 0);
  await store.throttle('one', 1, 60_000);
  await assert.rejects(store.throttle('one', 1, 60_000), { status: 429 });
  await store.logout(viewer);
  await assert.rejects(store.session(viewer), { status: 401 });
  console.log(
    'PASS: AWS SDK against DynamoDB Local validates transactional pairing, concurrent publication, owner list, revoke/delete, cleanup, rate limits and logout. S3 is an in-memory test double; no AWS account accessed.',
  );
} finally {
  await client.send(new DeleteTableCommand({ TableName: table }));
  client.destroy();
}
