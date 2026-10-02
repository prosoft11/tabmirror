import { createLocalApp } from './app';
try {
  const { server, config } = createLocalApp(process.env);
  server.on('error', () => {
    console.error('Local API could not listen. Check the configured port.');
    process.exitCode = 1;
  });
  server.listen(config.port, config.host, () =>
    console.info(
      `TabMirror synthetic API: http://${config.host}:${config.port}`,
    ),
  );
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => server.close());
} catch (err) {
  console.error(err instanceof Error ? err.message : 'Invalid configuration.');
  process.exitCode = 1;
}
