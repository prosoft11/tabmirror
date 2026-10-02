import {
  App,
  Annotations,
  Stack,
  Duration,
  RemovalPolicy,
  CfnOutput,
  CfnParameter,
  Tags,
  aws_certificatemanager as acm,
  aws_dynamodb as dynamodb,
  aws_s3 as s3,
  aws_secretsmanager as secrets,
  aws_lambda as lambda,
  aws_iam as iam,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_apigatewayv2 as gateway,
  aws_apigatewayv2_integrations as integrations,
  aws_logs as logs,
  aws_cloudwatch as cw,
  aws_cloudwatch_actions as actions,
  aws_sns as sns,
  aws_sns_subscriptions as subscriptions,
  aws_budgets as budgets,
  aws_events as events,
  aws_events_targets as targets,
} from 'aws-cdk-lib';
import { readFileSync } from 'node:fs';
const settings = JSON.parse(
  readFileSync('infra/production-settings.json', 'utf8'),
);
if (
  settings.accountId !== '400745793130' ||
  settings.region !== 'us-west-2' ||
  settings.certificateRegion !== 'us-east-1'
)
  throw Error('Deployment target mismatch');
const identity = JSON.parse(
  readFileSync('infra/extension-identity.json', 'utf8'),
);
const app = new App();
const certStack = new Stack(app, 'TabMirrorCertificate', {
  env: { account: settings.accountId, region: settings.certificateRegion },
  terminationProtection: true,
});
const certificate = new acm.Certificate(certStack, 'Certificate', {
  domainName: settings.hostname,
  validation: acm.CertificateValidation.fromDns(),
});
certificate.applyRemovalPolicy(RemovalPolicy.RETAIN);
new CfnOutput(certStack, 'CertificateArn', {
  value: certificate.certificateArn,
});
const data = new Stack(app, 'TabMirrorData', {
  env: { account: settings.accountId, region: settings.region },
  terminationProtection: true,
});
const table = new dynamodb.Table(data, 'Metadata', {
  partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  deletionProtection: true,
  removalPolicy: RemovalPolicy.RETAIN,
  timeToLiveAttribute: 'ttl',
  pointInTimeRecoverySpecification: {
    pointInTimeRecoveryEnabled: true,
    recoveryPeriodInDays: 7,
  },
});
const snapshots = new s3.Bucket(data, 'Snapshots', {
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
  encryption: s3.BucketEncryption.S3_MANAGED,
  enforceSSL: true,
  versioned: false,
  removalPolicy: RemovalPolicy.RETAIN,
});
const assets = new s3.Bucket(data, 'WebAssets', {
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
  encryption: s3.BucketEncryption.S3_MANAGED,
  enforceSSL: false,
  versioned: true,
  removalPolicy: RemovalPolicy.RETAIN,
});
const oauth = new secrets.CfnSecret(data, 'GoogleOAuth', {
  name: 'tabmirror/production/google-oauth',
  description:
    'Daniel supplies JSON clientId and clientSecret for the separate production Google OAuth web client.',
});
oauth.applyRemovalPolicy(RemovalPolicy.RETAIN);
new CfnOutput(data, 'GoogleSecretArn', { value: oauth.ref });
new CfnOutput(data, 'WebBucket', { value: assets.bucketName });
new CfnOutput(data, 'SnapshotBucket', { value: snapshots.bucketName });
new CfnOutput(data, 'TableName', { value: table.tableName });
const site = new Stack(app, 'TabMirrorApplication', {
  env: { account: settings.accountId, region: settings.region },
  terminationProtection: true,
});
const certArn = new CfnParameter(site, 'CertificateArn', {
  type: 'String',
  allowedPattern: `arn:aws:acm:us-east-1:${settings.accountId}:certificate/[a-f0-9-]+`,
  description: 'Issued ACM certificate in us-east-1 for tabs.portuit.com.',
});
const release = new CfnParameter(site, 'ReleaseId', {
  type: 'String',
  allowedPattern: '[a-zA-Z0-9-]{1,64}',
  description:
    'Immutable release prefix uploaded to WebBucket before deployment.',
});
const secret = secrets.Secret.fromSecretCompleteArn(site, 'OAuth', oauth.ref);
const logGroup = new logs.LogGroup(site, 'ApplicationLogs', {
  retention: logs.RetentionDays.TWO_WEEKS,
  removalPolicy: RemovalPolicy.RETAIN,
});
const runtimeRole = new iam.Role(site, 'ApiRuntimeRole', {
  assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
});
logGroup.grantWrite(runtimeRole);
const fn = new lambda.Function(site, 'Api', {
  role: runtimeRole,
  runtime: lambda.Runtime.NODEJS_22_X,
  architecture: lambda.Architecture.ARM_64,
  handler: 'index.handler',
  code: lambda.Code.fromAsset('artifacts/production/api'),
  memorySize: 512,
  timeout: Duration.seconds(30),
  reservedConcurrentExecutions: 5,
  logGroup,
  environment: {
    NODE_ENV: 'production',
    EXPECTED_ACCOUNT: settings.accountId,
    WEB_ORIGIN: `https://${settings.hostname}`,
    EXTENSION_ID: identity.id,
    TABLE_NAME: table.tableName,
    SNAPSHOT_BUCKET: snapshots.bucketName,
    GOOGLE_ALLOWED_EMAILS: settings.allowedEmails.join(','),
    GOOGLE_CLIENT_ID: secret.secretValueFromJson('clientId').unsafeUnwrap(),
    GOOGLE_CLIENT_SECRET: secret
      .secretValueFromJson('clientSecret')
      .unsafeUnwrap(),
  },
});
fn.addToRolePolicy(
  new iam.PolicyStatement({
    actions: [
      'dynamodb:GetItem',
      'dynamodb:Query',
      'dynamodb:PutItem',
      'dynamodb:DeleteItem',
      'dynamodb:ConditionCheckItem',
    ],
    resources: [table.tableArn],
  }),
);
fn.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
    resources: [snapshots.arnForObjects('snapshots/*')],
  }),
);
fn.currentVersion.applyRemovalPolicy(RemovalPolicy.RETAIN);
const alias = new lambda.Alias(site, 'Live', {
  aliasName: 'live',
  version: fn.currentVersion,
});
const api = new gateway.HttpApi(site, 'HttpApi', {
  defaultIntegration: new integrations.HttpLambdaIntegration(
    'Integration',
    alias,
  ),
  createDefaultStage: true,
});
const stage = api.defaultStage!.node.defaultChild as gateway.CfnStage;
stage.defaultRouteSettings = {
  throttlingBurstLimit: 20,
  throttlingRateLimit: 10,
};
const apiLogs = new logs.LogGroup(site, 'ApiLogs', {
  retention: logs.RetentionDays.TWO_WEEKS,
  removalPolicy: RemovalPolicy.RETAIN,
});
stage.accessLogSettings = {
  destinationArn: apiLogs.logGroupArn,
  format: JSON.stringify({
    requestId: '$context.requestId',
    status: '$context.status',
    route: '$context.routeKey',
    latency: '$context.responseLatency',
  }),
};
const headers = new cloudfront.ResponseHeadersPolicy(site, 'BrowserHeaders', {
  securityHeadersBehavior: {
    contentTypeOptions: { override: true },
    frameOptions: {
      frameOption: cloudfront.HeadersFrameOption.DENY,
      override: true,
    },
    referrerPolicy: {
      referrerPolicy: cloudfront.HeadersReferrerPolicy.NO_REFERRER,
      override: true,
    },
    strictTransportSecurity: {
      accessControlMaxAge: Duration.days(365),
      includeSubdomains: false,
      override: true,
    },
    contentSecurityPolicy: {
      contentSecurityPolicy:
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      override: true,
    },
  },
});
const rewrite = new cloudfront.Function(site, 'SpaRoutes', {
  code: cloudfront.FunctionCode.fromInline(
    "function handler(event) { var request = event.request; if (request.uri === '/' || request.uri === '/pair') request.uri = '/index.html'; return request; }",
  ),
});
const noCache = cloudfront.CachePolicy.CACHING_DISABLED;
const webOriginBucket = s3.Bucket.fromBucketAttributes(
  site,
  'WebOriginBucket',
  { bucketName: assets.bucketName, bucketArn: assets.bucketArn },
);
const distribution = new cloudfront.Distribution(site, 'Distribution', {
  domainNames: [settings.hostname],
  certificate: acm.Certificate.fromCertificateArn(
    site,
    'IssuedCertificate',
    certArn.valueAsString,
  ),
  minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
  defaultBehavior: {
    origin: origins.S3BucketOrigin.withOriginAccessControl(webOriginBucket, {
      originPath: `/releases/${release.valueAsString}`,
    }),
    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    cachePolicy: noCache,
    responseHeadersPolicy: headers,
    functionAssociations: [
      {
        function: rewrite,
        eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
      },
    ],
  },
  additionalBehaviors: {
    '/api/*': {
      origin: new origins.HttpOrigin(
        `${api.apiId}.execute-api.${settings.region}.amazonaws.com`,
      ),
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: noCache,
      originRequestPolicy:
        cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      responseHeadersPolicy: headers,
    },
  },
  priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
  enableLogging: false,
});
Annotations.of(distribution.node.findChild('Origin1')).acknowledgeWarning(
  '@aws-cdk/aws-cloudfront-origins:updateImportedBucketPolicyOac',
  'WebAccess in this stack explicitly grants this distribution and denies non-TLS requests; template tests verify both statements.',
);
const webPolicy = new s3.BucketPolicy(site, 'WebAccess', {
  bucket: webOriginBucket,
});
webPolicy.document.addStatements(
  new iam.PolicyStatement({
    effect: iam.Effect.DENY,
    principals: [new iam.AnyPrincipal()],
    actions: ['s3:*'],
    resources: [assets.bucketArn, assets.arnForObjects('*')],
    conditions: { Bool: { 'aws:SecureTransport': 'false' } },
  }),
);
webPolicy.document.addStatements(
  new iam.PolicyStatement({
    principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
    actions: ['s3:GetObject'],
    resources: [assets.arnForObjects('releases/*')],
    conditions: {
      StringEquals: {
        'AWS:SourceArn': `arn:aws:cloudfront::${settings.accountId}:distribution/${distribution.distributionId}`,
      },
    },
  }),
);
const topic = new sns.Topic(site, 'OperationalAlerts');
topic.addSubscription(
  new subscriptions.EmailSubscription(settings.notificationEmail),
);
for (const [name, metric] of [
  ['FunctionErrors', fn.metricErrors()],
  ['FunctionThrottles', fn.metricThrottles()],
  [
    'ApiErrors',
    new cw.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: '5xx',
      dimensionsMap: { ApiId: api.apiId },
      statistic: 'Sum',
      period: Duration.minutes(5),
    }),
  ],
  [
    'DatabaseThrottles',
    new cw.Metric({
      namespace: 'AWS/DynamoDB',
      metricName: 'ThrottledRequests',
      dimensionsMap: { TableName: table.tableName },
      statistic: 'Sum',
      period: Duration.minutes(5),
    }),
  ],
] as const) {
  const alarm = new cw.Alarm(site, name, {
    metric,
    threshold: 1,
    evaluationPeriods: 1,
    treatMissingData: cw.TreatMissingData.NOT_BREACHING,
  });
  alarm.addAlarmAction(new actions.SnsAction(topic));
}
new budgets.CfnBudget(site, 'MonthlyBudget', {
  budget: {
    budgetName: 'TabMirrorPilotAccountBudget',
    budgetType: 'COST',
    timeUnit: 'MONTHLY',
    budgetLimit: { amount: settings.monthlyBudgetUsd, unit: 'USD' },
  },
  notificationsWithSubscribers: [
    {
      notification: {
        comparisonOperator: 'GREATER_THAN',
        notificationType: 'ACTUAL',
        threshold: 100,
        thresholdType: 'PERCENTAGE',
      },
      subscribers: [
        { subscriptionType: 'EMAIL', address: settings.notificationEmail },
      ],
    },
  ],
});
new events.Rule(site, 'CleanupSchedule', {
  schedule: events.Schedule.rate(Duration.minutes(15)),
  targets: [
    new targets.LambdaFunction(alias, {
      event: events.RuleTargetInput.fromObject({ source: 'tabmirror.cleanup' }),
      retryAttempts: 2,
    }),
  ],
});
new CfnOutput(site, 'Website', { value: `https://${settings.hostname}` });
new CfnOutput(site, 'CloudFrontCnameTarget', {
  value: distribution.distributionDomainName,
});
new CfnOutput(site, 'DistributionId', { value: distribution.distributionId });
new CfnOutput(site, 'ExtensionId', { value: identity.id });
for (const stack of [certStack, data, site])
  Tags.of(stack).add('Project', 'TabMirror');
app.synth();
