import { readFileSync, writeFileSync } from 'node:fs';
// The standard CDK bootstrap infrastructure is retained; only its execution permissions change.
let template = readFileSync('artifacts/bootstrap-template.yaml', 'utf8');
const start = template.indexOf(
  '      ManagedPolicyArns:',
  template.indexOf('  CloudFormationExecutionRole:'),
);
const end = template.indexOf('      RoleName:', start);
if (start < 0 || end < 0) throw Error('Unexpected bootstrap template');
const statement = (Action, Resource, Condition) => ({
  Effect: 'Allow',
  Action,
  Resource,
  ...(Condition ? { Condition } : {}),
});
const policies = [
  {
    PolicyName: 'TabMirrorFoundationOnly',
    PolicyDocument: {
      Version: '2012-10-17',
      Statement: [
        statement(
          ['ssm:GetParameters'],
          [
            'arn:aws:ssm:us-west-2:400745793130:parameter/cdk-bootstrap/hnb659fds/version',
            'arn:aws:ssm:us-east-1:400745793130:parameter/cdk-bootstrap/hnb659fds/version',
          ],
        ),
        statement(
          [
            's3:CreateBucket',
            's3:DeleteBucket',
            's3:GetBucket*',
            's3:ListBucket',
            's3:PutBucket*',
            's3:PutEncryptionConfiguration',
            's3:GetEncryptionConfiguration',
            's3:GetAccelerateConfiguration',
            's3:GetLifecycleConfiguration',
            's3:GetAnalyticsConfiguration',
            's3:GetInventoryConfiguration',
            's3:GetMetricsConfiguration',
            's3:GetReplicationConfiguration',
            's3:GetIntelligentTieringConfiguration',
            's3:ListTagsForResource',
            's3:TagResource',
            's3:UntagResource',
            's3:DeleteBucketPolicy',
          ],
          ['arn:aws:s3:::tabmirrordata-*'],
        ),
        statement(
          [
            'dynamodb:CreateTable',
            'dynamodb:DescribeTable',
            'dynamodb:UpdateTable',
            'dynamodb:DeleteTable',
            'dynamodb:DescribeContinuousBackups',
            'dynamodb:UpdateContinuousBackups',
            'dynamodb:DescribeTimeToLive',
            'dynamodb:UpdateTimeToLive',
            'dynamodb:TagResource',
            'dynamodb:UntagResource',
            'dynamodb:ListTagsOfResource',
          ],
          ['arn:aws:dynamodb:us-west-2:400745793130:table/TabMirrorData-*'],
        ),
        statement(
          [
            'secretsmanager:CreateSecret',
            'secretsmanager:DescribeSecret',
            'secretsmanager:TagResource',
            'secretsmanager:UntagResource',
            'secretsmanager:UpdateSecret',
            'secretsmanager:DeleteSecret',
            'secretsmanager:GetResourcePolicy',
            'secretsmanager:PutResourcePolicy',
          ],
          [
            'arn:aws:secretsmanager:us-west-2:400745793130:secret:tabmirror/production/google-oauth-*',
          ],
        ),
        statement(['acm:RequestCertificate'], '*', {
          StringEquals: { 'aws:RequestedRegion': 'us-east-1' },
          'ForAllValues:StringEquals': {
            'acm:DomainNames': ['tabs.portuit.com'],
          },
          Null: { 'acm:DomainNames': 'false' },
        }),
        statement(
          [
            'acm:DescribeCertificate',
            'acm:AddTagsToCertificate',
            'acm:RemoveTagsFromCertificate',
            'acm:ListTagsForCertificate',
            'acm:DeleteCertificate',
          ],
          ['arn:aws:acm:us-east-1:400745793130:certificate/*'],
        ),
      ],
    },
  },
];
template =
  template.slice(0, start) +
  '      Policies: ' +
  JSON.stringify(policies) +
  '\n' +
  template.slice(end);
template = template.replace(
  'Default: "AWS CDK: Default Resources"',
  'Default: "TabMirror: Foundation Only v1"',
);
writeFileSync('infra/bootstrap-foundation.yaml', template);
writeFileSync('artifacts/foundation-policies.json', JSON.stringify(policies));
console.log(
  'Prepared scoped bootstrap template; no AdministratorAccess execution policy and no secret-value read permissions.',
);
