export interface LocalConfig {
  host: '127.0.0.1';
  port: number;
  webPort: number;
}
export function readConfig(env: NodeJS.ProcessEnv): LocalConfig {
  if (
    env.NODE_ENV !== 'development' ||
    env.APP_MODE !== 'local' ||
    env.AUTH_MODE !== 'mock' ||
    env.STORAGE_DRIVER !== 'memory'
  ) {
    throw new Error(
      'Phase 2 requires explicit development/local/mock/memory configuration. Production authentication and storage are not implemented.',
    );
  }
  if (env.API_HOST !== '127.0.0.1')
    throw new Error('Local API must bind to 127.0.0.1.');
  const port = (value: string | undefined) => {
    if (
      !value ||
      !/^\d+$/.test(value) ||
      Number(value) < 1024 ||
      Number(value) > 65535
    )
      throw new Error('Invalid local port.');
    return Number(value);
  };
  const apiPort = port(env.API_PORT),
    webPort = port(env.WEB_PORT);
  if (apiPort === webPort) throw new Error('API and web ports must differ.');
  return { host: '127.0.0.1', port: apiPort, webPort };
}
