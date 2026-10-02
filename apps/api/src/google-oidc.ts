import * as oidc from 'openid-client';
import { ApiError, digest } from './private-store.js';
import type { GoogleIdentity } from './auth-store.js';
export interface IdentityProvider {
  authorizationUrl(browserSecret: string): Promise<string>;
  exchange(callback: URL, browserSecret: string): Promise<GoogleIdentity>;
}
export const loginChecks = (secret: string) => ({
  expectedState: digest(`state:${secret}`),
  expectedNonce: digest(`nonce:${secret}`),
  pkceCodeVerifier: digest(`pkce:${secret}`),
});
/** Constructor accepts a validated OIDC configuration so tests can use a signed local issuer.
 * The application bootstrap only uses Google discovery, never a user-controlled issuer URL.
 */
export class GoogleOidc implements IdentityProvider {
  constructor(
    private configuration: oidc.Configuration,
    private redirectUri: string,
  ) {
    oidc.enableNonRepudiationChecks(configuration);
  }
  static async discover(
    clientId: string,
    clientSecret: string,
    redirectUri: string,
  ) {
    const configuration = await oidc.discovery(
      new URL('https://accounts.google.com'),
      clientId,
      { client_secret: clientSecret, id_token_signed_response_alg: 'RS256' },
      undefined,
      { timeout: 10 },
    );
    return new GoogleOidc(configuration, redirectUri);
  }
  async authorizationUrl(secret: string) {
    const checks = loginChecks(secret);
    return oidc.buildAuthorizationUrl(this.configuration, {
      redirect_uri: this.redirectUri,
      scope: 'openid email',
      response_type: 'code',
      state: checks.expectedState,
      nonce: checks.expectedNonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(
        checks.pkceCodeVerifier,
      ),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).href;
  }
  async exchange(callback: URL, secret: string): Promise<GoogleIdentity> {
    if (callback.origin + callback.pathname !== this.redirectUri)
      throw new ApiError(401, 'LOGIN_FAILED', 'Sign-in could not be verified.');
    try {
      const tokens = await oidc.authorizationCodeGrant(
        this.configuration,
        callback,
        { ...loginChecks(secret), idTokenExpected: true },
      );
      const claims = tokens.claims();
      if (
        !claims ||
        typeof claims.sub !== 'string' ||
        !claims.sub ||
        typeof claims.email !== 'string' ||
        claims.email_verified !== true
      )
        throw new Error('Unverified identity');
      return {
        subject: claims.sub,
        email: claims.email.toLowerCase(),
        emailVerified: true,
      };
    } catch {
      throw new ApiError(
        401,
        'LOGIN_FAILED',
        'Sign-in could not be verified. Start again.',
      );
    }
  }
}
