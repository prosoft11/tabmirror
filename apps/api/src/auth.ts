export interface Identity {
  ownerId: string;
  mode: 'local-mock';
}
export interface Authenticator {
  authenticate(): Promise<Identity>;
}
/** Only constructed behind readConfig's development guard. Never trusts request owner fields. */
export class LocalFixtureAuthenticator implements Authenticator {
  async authenticate(): Promise<Identity> {
    return { ownerId: 'synthetic-local-user', mode: 'local-mock' };
  }
}
