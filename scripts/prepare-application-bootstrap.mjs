import { readFileSync, writeFileSync } from 'node:fs';
let template = readFileSync('infra/bootstrap-foundation.yaml', 'utf8');
const start = template.indexOf(
  '      Policies:',
  template.indexOf('  CloudFormationExecutionRole:'),
);
const end = template.indexOf('      RoleName:', start);
if (start < 0 || end < 0) throw Error('Unexpected scoped bootstrap template');
// Foundation permissions are generated as a flow-style YAML object compatible with JS literals.
// Use the original unformatted generated JSON via a fresh preparation step instead of parsing YAML.
const raw = readFileSync('artifacts/bootstrap-template.yaml', 'utf8');
const s = (Action, Resource, Condition) => ({
  Effect: 'Allow',
  Action,
  Resource,
  ...(Condition ? { Condition } : {}),
});
const account = '400745793130',
  region = 'us-west-2';
const policies = [
  {
    PolicyName: 'TabMirrorApplicationDeployment',
    PolicyDocument: {
      Version: '2012-10-17',
      Statement: [
        s(
          [
            'cloudfront:CreateDistribution',
            'cloudfront:CreateFunction',
            'cloudfront:CreateOriginAccessControl',
            'cloudfront:CreateResponseHeadersPolicy',
          ],
          '*',
        ),
        s(
          [
            'cloudfront:TagResource',
            'cloudfront:UntagResource',
            'cloudfront:ListTagsForResource',
          ],
          `arn:aws:cloudfront::${account}:function/us-west-2TabMirrorApplication*`,
        ),
        s(
          ['ssm:GetParameters'],
          `arn:aws:ssm:${region}:${account}:parameter/cdk-bootstrap/hnb659fds/version`,
        ),
        s(
          ['s3:GetObject', 's3:GetObjectVersion'],
          `arn:aws:s3:::cdk-hnb659fds-assets-${account}-${region}/*`,
        ),
        s(
          ['s3:GetBucketPolicy', 's3:PutBucketPolicy', 's3:DeleteBucketPolicy'],
          'arn:aws:s3:::tabmirrordata-webassets27872646-odbdb9wigark',
        ),
        s(
          ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
          'arn:aws:secretsmanager:us-west-2:400745793130:secret:tabmirror/production/google-oauth-KCeRHP',
        ),
        s(
          [
            'iam:CreateRole',
            'iam:DeleteRole',
            'iam:GetRole',
            'iam:TagRole',
            'iam:UntagRole',
            'iam:ListRoleTags',
            'iam:UpdateAssumeRolePolicy',
            'iam:PutRolePolicy',
            'iam:GetRolePolicy',
            'iam:DeleteRolePolicy',
            'iam:ListRolePolicies',
            'iam:ListAttachedRolePolicies',
          ],
          `arn:aws:iam::${account}:role/TabMirrorApplication-*`,
        ),
        s(
          ['iam:PassRole'],
          `arn:aws:iam::${account}:role/TabMirrorApplication-*`,
          { StringEquals: { 'iam:PassedToService': 'lambda.amazonaws.com' } },
        ),
        s(
          [
            'lambda:CreateFunction',
            'lambda:DeleteFunction',
            'lambda:GetFunction',
            'lambda:GetFunctionConfiguration',
            'lambda:UpdateFunctionCode',
            'lambda:UpdateFunctionConfiguration',
            'lambda:PutFunctionConcurrency',
            'lambda:DeleteFunctionConcurrency',
            'lambda:GetFunctionConcurrency',
            'lambda:TagResource',
            'lambda:UntagResource',
            'lambda:ListTags',
            'lambda:PublishVersion',
            'lambda:ListVersionsByFunction',
            'lambda:CreateAlias',
            'lambda:UpdateAlias',
            'lambda:DeleteAlias',
            'lambda:GetAlias',
            'lambda:AddPermission',
            'lambda:RemovePermission',
            'lambda:GetPolicy',
            'lambda:PutFunctionEventInvokeConfig',
            'lambda:DeleteFunctionEventInvokeConfig',
            'lambda:GetFunctionEventInvokeConfig',
          ],
          `arn:aws:lambda:${region}:${account}:function:TabMirrorApplication-*`,
        ),
        s(
          [
            'logs:CreateLogGroup',
            'logs:DeleteLogGroup',
            'logs:PutRetentionPolicy',
            'logs:DeleteRetentionPolicy',
            'logs:TagResource',
            'logs:UntagResource',
            'logs:TagLogGroup',
            'logs:UntagLogGroup',
            'logs:ListTagsForResource',
            'logs:ListTagsLogGroup',
            'logs:DescribeLogStreams',
          ],
          [
            `arn:aws:logs:${region}:${account}:log-group:TabMirrorApplication-*`,
            `arn:aws:logs:${region}:${account}:log-group:TabMirrorApplication-*:*`,
          ],
        ),
        s(
          [
            'logs:DescribeLogGroups',
            'logs:DescribeResourcePolicies',
            'logs:PutResourcePolicy',
            'logs:CreateLogDelivery',
            'logs:GetLogDelivery',
            'logs:UpdateLogDelivery',
            'logs:DeleteLogDelivery',
            'logs:ListLogDeliveries',
          ],
          '*',
          { StringEquals: { 'aws:RequestedRegion': region } },
        ),
        s(
          [
            'apigateway:GET',
            'apigateway:TagResource',
            'apigateway:POST',
            'apigateway:PUT',
            'apigateway:PATCH',
            'apigateway:DELETE',
          ],
          [
            `arn:aws:apigateway:${region}::/apis`,
            `arn:aws:apigateway:${region}::/apis/*`,
            `arn:aws:apigateway:${region}::/tags/*`,
          ],
        ),
        s(
          [
            'cloudfront:GetDistribution',
            'cloudfront:GetDistributionConfig',
            'cloudfront:UpdateDistribution',
            'cloudfront:DeleteDistribution',
            'cloudfront:TagResource',
            'cloudfront:UntagResource',
            'cloudfront:ListTagsForResource',
          ],
          `arn:aws:cloudfront::${account}:distribution/*`,
        ),
        s(
          [
            'cloudfront:DescribeFunction',
            'cloudfront:GetFunction',
            'cloudfront:UpdateFunction',
            'cloudfront:PublishFunction',
            'cloudfront:DeleteFunction',
          ],
          `arn:aws:cloudfront::${account}:function/us-west-2TabMirrorApplication*`,
        ),
        s(
          [
            'cloudfront:GetOriginAccessControl',
            'cloudfront:GetOriginAccessControlConfig',
            'cloudfront:UpdateOriginAccessControl',
            'cloudfront:DeleteOriginAccessControl',
          ],
          `arn:aws:cloudfront::${account}:origin-access-control/*`,
        ),
        s(
          [
            'cloudfront:GetResponseHeadersPolicy',
            'cloudfront:GetResponseHeadersPolicyConfig',
            'cloudfront:UpdateResponseHeadersPolicy',
            'cloudfront:DeleteResponseHeadersPolicy',
          ],
          `arn:aws:cloudfront::${account}:response-headers-policy/*`,
        ),
        s(
          ['acm:DescribeCertificate'],
          'arn:aws:acm:us-east-1:400745793130:certificate/888c7aa3-07e2-47e9-b052-455e03cfd154',
        ),
        s(
          [
            'sns:CreateTopic',
            'sns:DeleteTopic',
            'sns:GetTopicAttributes',
            'sns:SetTopicAttributes',
            'sns:TagResource',
            'sns:UntagResource',
            'sns:ListTagsForResource',
            'sns:Subscribe',
            'sns:ListSubscriptionsByTopic',
          ],
          `arn:aws:sns:${region}:${account}:TabMirrorApplication-*`,
        ),
        s(
          [
            'sns:GetSubscriptionAttributes',
            'sns:SetSubscriptionAttributes',
            'sns:Unsubscribe',
          ],
          `arn:aws:sns:${region}:${account}:TabMirrorApplication-*:*`,
        ),
        s(
          [
            'cloudwatch:PutMetricAlarm',
            'cloudwatch:DeleteAlarms',
            'cloudwatch:DescribeAlarms',
            'cloudwatch:TagResource',
            'cloudwatch:UntagResource',
            'cloudwatch:ListTagsForResource',
          ],
          `arn:aws:cloudwatch:${region}:${account}:alarm:TabMirrorApplication-*`,
        ),
        s(
          [
            'events:PutRule',
            'events:DeleteRule',
            'events:DescribeRule',
            'events:PutTargets',
            'events:RemoveTargets',
            'events:ListTargetsByRule',
            'events:TagResource',
            'events:UntagResource',
            'events:ListTagsForResource',
          ],
          `arn:aws:events:${region}:${account}:rule/TabMirrorApplication-*`,
        ),
        s(
          [
            'budgets:ModifyBudget',
            'budgets:ViewBudget',

            'budgets:TagResource',
            'budgets:UntagResource',
            'budgets:ListTagsForResource',
          ],
          `arn:aws:budgets::${account}:budget/TabMirrorPilotAccountBudget`,
        ),
      ],
    },
  },
];
const foundation = JSON.parse(
  readFileSync('artifacts/foundation-policies.json', 'utf8'),
);
const combined = [...foundation, ...policies];
const bytes = combined.reduce(
  (sum, p) => sum + JSON.stringify(p.PolicyDocument).length,
  0,
);
if (bytes > 10240)
  throw Error(`Inline execution policies exceed IAM limit: ${bytes}`);
template =
  template.slice(0, start) +
  '      Policies: ' +
  JSON.stringify(combined) +
  '\n' +
  template.slice(end);
if (raw.includes('TabMirrorApplicationDeployment'))
  throw Error('Unexpected base template');
writeFileSync('infra/bootstrap-application.yaml', template);
writeFileSync(
  'artifacts/application-policy.json',
  JSON.stringify(policies[0].PolicyDocument, null, 2),
);
console.log(
  'Prepared application deployment policy; secret resolution is confined to CloudFormation and the exact OAuth ARN.',
);
