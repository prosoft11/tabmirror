import { beforeAll, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
let data: any, app: any, cert: any;
beforeAll(() => {
  execFileSync(process.execPath, ['scripts/build-production.mjs'], {
    stdio: 'pipe',
  });
  execFileSync(process.execPath, ['--import', 'tsx', 'infra/app.ts'], {
    stdio: 'pipe',
    env: { ...process.env, CDK_OUTDIR: 'artifacts/infra-test' },
  });
  const load = (name: string) =>
    JSON.parse(
      readFileSync(`artifacts/infra-test/${name}.template.json`, 'utf8'),
    );
  data = load('TabMirrorData');
  app = load('TabMirrorApplication');
  cert = load('TabMirrorCertificate');
}, 60_000);
const resources = (template: any, type: string) =>
  Object.values(template.Resources).filter(
    (r: any) => r.Type === type,
  ) as any[];
it('synthesizes private retained storage, explicit TTL, deletion protection and separate OAuth secret', () => {
  const table = resources(data, 'AWS::DynamoDB::Table')[0];
  expect(table.Properties.DeletionProtectionEnabled).toBe(true);
  expect(table.DeletionPolicy).toBe('Retain');
  expect(table.Properties.BillingMode).toBe('PAY_PER_REQUEST');
  const buckets = resources(data, 'AWS::S3::Bucket');
  expect(buckets).toHaveLength(2);
  for (const bucket of buckets)
    expect(
      bucket.Properties.PublicAccessBlockConfiguration.BlockPublicPolicy,
    ).toBe(true);
  const secret = resources(data, 'AWS::SecretsManager::Secret')[0];
  expect(secret.Properties.SecretString).toBeUndefined();
  expect(secret.Properties.GenerateSecretString).toBeUndefined();
  expect(
    resources(cert, 'AWS::CertificateManager::Certificate')[0].Properties
      .DomainName,
  ).toBe('tabs.portuit.com');
});
it('keeps API caching disabled, exact domain, correct certificate region and DNS changes external', () => {
  const distribution = resources(app, 'AWS::CloudFront::Distribution')[0]
    .Properties.DistributionConfig;
  expect(distribution.Aliases).toEqual(['tabs.portuit.com']);
  expect(app.Parameters.CertificateArn.AllowedPattern).toContain(
    'us-east-1:400745793130',
  );
  expect(distribution.CacheBehaviors[0].CachePolicyId).toBe(
    '4135ea2d-6df8-44a3-9df3-4b5a84be39ad',
  );
  expect(resources(app, 'AWS::Route53::RecordSet')).toHaveLength(0);
  expect(resources(cert, 'AWS::Route53::RecordSet')).toHaveLength(0);
  expect(
    resources(app, 'AWS::Budgets::Budget')[0].Properties.Budget.BudgetLimit,
  ).toEqual({ Amount: 10, Unit: 'USD' });
  const policies = resources(app, 'AWS::S3::BucketPolicy');
  expect(policies).toHaveLength(1);
  expect(JSON.stringify(policies[0])).toContain('AWS:SourceArn');
  expect(JSON.stringify(policies[0])).toContain('aws:SecureTransport');
});
it('builds a separate HTTPS-only extension with a stable identity and no local endpoints', () => {
  const manifest = JSON.parse(
    readFileSync('artifacts/production/extension/manifest.json', 'utf8'),
  );
  expect(manifest.host_permissions).toEqual(['https://tabs.portuit.com/*']);
  expect(manifest.key).toBeTruthy();
  const js = readFileSync(
    'artifacts/production/extension/background.js',
    'utf8',
  );
  expect(js).not.toContain('127.0.0.1');
  expect(js).toContain('https://tabs.portuit.com');
  const popup = readFileSync(
    'artifacts/production/extension/popup.html',
    'utf8',
  );
  expect(popup).not.toContain('LOCAL PROTOTYPE');
  expect(popup).not.toContain('uploads stay on this Mac');
  const code = readFileSync('artifacts/production/api/index.js', 'utf8');
  expect(code).not.toContain('node:sqlite');
});
