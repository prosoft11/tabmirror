import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const exec = promisify(execFile);
async function aws(args, region = 'us-west-2') {
  const { stdout } = await exec(
    'aws',
    [
      ...args,
      '--profile',
      'default',
      '--region',
      region,
      '--output',
      'json',
      '--no-cli-pager',
    ],
    { maxBuffer: 1024 * 1024 },
  );
  return stdout.trim() ? JSON.parse(stdout) : {};
}
const account = (await aws(['sts', 'get-caller-identity'])).Account;
assert.equal(account, '400745793130', 'Wrong account; stopped');
const stack = (
  await aws([
    'cloudformation',
    'describe-stacks',
    '--stack-name',
    'TabMirrorData',
  ])
).Stacks[0];
assert.equal(stack.StackStatus, 'UPDATE_COMPLETE');
assert.equal(stack.EnableTerminationProtection, true);
const outputs = Object.fromEntries(
  stack.Outputs.map((o) => [o.OutputKey, o.OutputValue]),
);
const checks = await Promise.allSettled([
  ...['SnapshotBucket', 'WebBucket'].map(async (name) => {
    const bucket = outputs[name];
    const [access, encryption, version] = await Promise.all([
      aws(['s3api', 'get-public-access-block', '--bucket', bucket]),
      aws(['s3api', 'get-bucket-encryption', '--bucket', bucket]),
      aws(['s3api', 'get-bucket-versioning', '--bucket', bucket]),
    ]);
    assert.ok(
      Object.values(access.PublicAccessBlockConfiguration).every(
        (v) => v === true,
      ),
    );
    assert.equal(
      encryption.ServerSideEncryptionConfiguration.Rules[0]
        .ApplyServerSideEncryptionByDefault.SSEAlgorithm,
      'AES256',
    );
    if (name === 'WebBucket') assert.equal(version.Status, 'Enabled');
    else assert.notEqual(version.Status, 'Enabled');
    return {
      name,
      bucket,
      private: true,
      encryption: 'AES256',
      versioned: version.Status === 'Enabled',
    };
  }),
  (async () => {
    const [table, ttl, backup] = await Promise.all([
      aws(['dynamodb', 'describe-table', '--table-name', outputs.TableName]),
      aws([
        'dynamodb',
        'describe-time-to-live',
        '--table-name',
        outputs.TableName,
      ]),
      aws([
        'dynamodb',
        'describe-continuous-backups',
        '--table-name',
        outputs.TableName,
      ]),
    ]);
    assert.equal(table.Table.TableStatus, 'ACTIVE');
    assert.equal(table.Table.DeletionProtectionEnabled, true);
    assert.equal(table.Table.BillingModeSummary.BillingMode, 'PAY_PER_REQUEST');
    assert.equal(ttl.TimeToLiveDescription.TimeToLiveStatus, 'ENABLED');
    assert.equal(ttl.TimeToLiveDescription.AttributeName, 'ttl');
    const pitr =
      backup.ContinuousBackupsDescription.PointInTimeRecoveryDescription;
    assert.equal(pitr.PointInTimeRecoveryStatus, 'ENABLED');
    assert.equal(pitr.RecoveryPeriodInDays, 7);
    return {
      name: 'Metadata',
      table: outputs.TableName,
      active: true,
      ttl: true,
      pitrDays: 7,
      deletionProtection: true,
    };
  })(),
  (async () => {
    const value = await aws([
      'secretsmanager',
      'describe-secret',
      '--secret-id',
      outputs.GoogleSecretArn,
    ]);
    return {
      name: 'OAuth',
      arn: value.ARN,
      hasCurrentVersion: Object.values(value.VersionIdsToStages ?? {}).some(
        (s) => s.includes('AWSCURRENT'),
      ),
    };
  })(),
  ...['us-west-2', 'us-east-1'].map(async (region) => {
    const role = `cdk-hnb659fds-cfn-exec-role-400745793130-${region}`;
    const managed = await aws(
      ['iam', 'list-attached-role-policies', '--role-name', role],
      region,
    );
    assert.equal(managed.AttachedPolicies.length, 0);
    return { name: 'ExecutionRole', region, managedPolicies: 0 };
  }),
]);
const failures = checks.filter((c) => c.status === 'rejected');
for (const check of checks) {
  if (check.status === 'fulfilled') console.log(JSON.stringify(check.value));
  else
    console.error(
      'Foundation metadata check failed:',
      check.reason instanceof assert.AssertionError
        ? check.reason.message
        : 'AWS metadata call failed',
    );
}
assert.equal(failures.length, 0, 'Foundation verification incomplete');
await mkdir('artifacts/foundation', { recursive: true });
await writeFile(
  'artifacts/foundation/verification.json',
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      account,
      checks: checks.map((c) => c.value),
    },
    null,
    2,
  ) + '\n',
);
console.log(
  'PASS: foundation metadata verification; no secret values or browsing data read.',
);
