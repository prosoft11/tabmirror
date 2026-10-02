import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { CloudStore } from './store.js';
import { DynamoBackend } from './transactions.js';
import { S3Objects } from './objects.js';
import { httpAdapter } from './http-adapter.js';
import { extensionOrigins } from './extension-origins.js';
import { WebAuth } from '../web-auth.js';
import { createPrivateApi } from '../private-api.js';
import { GoogleOidc, type IdentityProvider } from '../google-oidc.js';
const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw Error(`Missing production setting: ${name}`);
  return value;
};
let runtime: ReturnType<typeof initialize> | undefined;
function initialize() {
  if (
    process.env.NODE_ENV !== 'production' ||
    required('AWS_REGION') !== 'us-west-2' ||
    required('EXPECTED_ACCOUNT') !== '400745793130'
  )
    throw Error('Production environment mismatch');
  const origin = required('WEB_ORIGIN');
  if (origin !== 'https://tabs.portuit.com')
    throw Error('Production origin mismatch');
  const extensionOrigin = extensionOrigins(required('EXTENSION_IDS'));
  const clientId = required('GOOGLE_CLIENT_ID'),
    clientSecret = required('GOOGLE_CLIENT_SECRET');
  const emails = required('GOOGLE_ALLOWED_EMAILS').split(',');
  const config = { region: 'us-west-2', maxAttempts: 3 };
  const backend = new DynamoBackend(
    DynamoDBDocumentClient.from(new DynamoDBClient(config), {
      marshallOptions: { removeUndefinedValues: true },
    }),
    required('TABLE_NAME'),
  );
  const store = new CloudStore(
    backend,
    new S3Objects(new S3Client(config), required('SNAPSHOT_BUCKET')),
  );
  let discovery: Promise<IdentityProvider> | undefined;
  const clientIp = (req: import('node:http').IncomingMessage) =>
    String(req.headers['x-tabmirror-source-ip'] ?? 'unknown');
  const auth = new WebAuth(store, {
    origin,
    local: false,
    allowedEmails: emails,
    clientIp,
    provider: () =>
      (discovery ??= GoogleOidc.discover(
        clientId,
        clientSecret,
        `${origin}/api/auth/callback`,
      ).catch((error) => {
        discovery = undefined;
        throw error;
      })),
  });
  const server = createPrivateApi(store, {
    auth,
    allowedHosts: [new URL(origin).host],
    viewerOrigin: origin,
    extensionOrigin,
    clientIp,
    throttle: (key, maximum, ms) => store.throttle(key, maximum, ms),
    log: (event) => console.log(JSON.stringify(event)),
  });
  return { serve: httpAdapter(server, new URL(origin).host), store };
}
export async function handler(
  event: APIGatewayProxyEventV2 | { source: string },
  context: Context,
) {
  context.callbackWaitsForEmptyEventLoop = false;
  if (context.invokedFunctionArn.split(':')[4] !== '400745793130')
    throw Error('AWS account mismatch');
  try {
    const app = (runtime ??= initialize());
    if ('source' in event && event.source === 'tabmirror.cleanup')
      return await app.store.cleanup();
    return await app.serve(event as APIGatewayProxyEventV2);
  } catch {
    // Do not expose SDK errors, configuration or secret material.
    console.error(
      JSON.stringify({ operation: 'production-handler', status: 500 }),
    );
    if ('source' in event) throw Error('Cleanup failed');
    return {
      statusCode: 503,
      headers: {
        'cache-control': 'no-store',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        error: { code: 'UNAVAILABLE', message: 'Please retry shortly.' },
      }),
    };
  }
}
