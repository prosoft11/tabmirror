import { expect, it } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import * as oidc from 'openid-client';
import { GoogleOidc, loginChecks } from '../apps/api/src/google-oidc';
const issuer = 'https://accounts.google.com',
  clientId = 'test-client',
  redirect = 'http://127.0.0.1:4317/api/auth/callback',
  secret = 'a'.repeat(64);
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
function setup(overrides: Record<string, unknown> = {}, badSignature = false) {
  const configuration = new oidc.Configuration(
    {
      issuer,
      authorization_endpoint: `${issuer}/auth`,
      token_endpoint: 'https://oauth2.googleapis.com/token',
      jwks_uri: `${issuer}/jwks`,
    },
    clientId,
    {
      client_secret: 'synthetic-secret',
      id_token_signed_response_alg: 'RS256',
    },
  );
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: issuer,
    aud: clientId,
    sub: 'google-subject',
    iat: now,
    exp: now + 300,
    nonce: loginChecks(secret).expectedNonce,
    email: 'daniel@example.test',
    email_verified: true,
    ...overrides,
  };
  const encoded = [{ alg: 'RS256', kid: 'key' }, claims]
    .map((v) => Buffer.from(JSON.stringify(v)).toString('base64url'))
    .join('.');
  const signature = sign(
    'RSA-SHA256',
    Buffer.from(encoded),
    keys.privateKey,
  ).toString('base64url');
  const token = `${encoded}.${badSignature ? 'invalid' : signature}`;
  configuration[oidc.customFetch] = async (url, init) => {
    if (String(url).endsWith('/jwks'))
      return Response.json({
        keys: [
          {
            ...keys.publicKey.export({ format: 'jwk' }),
            kid: 'key',
            alg: 'RS256',
            use: 'sig',
          },
        ],
      });
    expect(String(init?.body)).toContain('code_verifier=');
    return Response.json({
      access_token: 'synthetic-access',
      token_type: 'Bearer',
      id_token: token,
    });
  };
  return new GoogleOidc(configuration, redirect);
}
const callback = (state = loginChecks(secret).expectedState) =>
  new URL(`${redirect}?code=test&state=${state}`);
it('uses PKCE S256 and nonce/state, verifies a signed token, and returns only verified identity', async () => {
  const provider = setup(),
    url = new URL(await provider.authorizationUrl(secret));
  expect(url.searchParams.get('scope')).toBe('openid email');
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(url.searchParams.get('nonce')).toBe(loginChecks(secret).expectedNonce);
  expect(await provider.exchange(callback(), secret)).toEqual({
    subject: 'google-subject',
    email: 'daniel@example.test',
    emailVerified: true,
  });
});
it.each([
  { iss: 'https://evil.example' },
  { aud: 'other-client' },
  { exp: 1 },
  { nonce: 'wrong' },
  { email_verified: false },
  { sub: '' },
])('rejects invalid identity claims %j', async (overrides) => {
  await expect(setup(overrides).exchange(callback(), secret)).rejects.toThrow(
    'could not be verified',
  );
});
it('rejects bad signature, mismatched state and wrong callback URI', async () => {
  await expect(setup({}, true).exchange(callback(), secret)).rejects.toThrow(
    'could not be verified',
  );
  await expect(setup().exchange(callback('wrong'), secret)).rejects.toThrow(
    'could not be verified',
  );
  await expect(
    setup().exchange(new URL('https://evil.example/callback'), secret),
  ).rejects.toThrow('could not be verified');
});
