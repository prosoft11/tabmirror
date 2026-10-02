import { request, type Server } from 'node:http';
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { MAX_SNAPSHOT_BYTES } from '@tabmirror/contracts';
/** HTTP bridge preserves the existing body parser and response cookies. The socket is loopback-only. */
export function httpAdapter(server: Server, hostname: string) {
  let address: Promise<number> | undefined;
  const port = () =>
    (address ??= new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const value = server.address();
        if (!value || typeof value === 'string')
          return reject(Error('Listener unavailable'));
        server.unref();
        resolve(value.port);
      });
    }));
  return async (
    event: APIGatewayProxyEventV2,
  ): Promise<APIGatewayProxyStructuredResultV2> => {
    if (
      event.version !== '2.0' ||
      !event.rawPath.startsWith('/api/') ||
      /[\r\n?#]/.test(event.rawPath)
    )
      return {
        statusCode: 400,
        headers: { 'cache-control': 'no-store' },
        body: '{}',
      };
    const raw = event.body ?? '';
    if (
      raw.length > MAX_SNAPSHOT_BYTES * 2 ||
      (event.isBase64Encoded &&
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
          raw,
        ))
    )
      return {
        statusCode: 413,
        headers: { 'cache-control': 'no-store' },
        body: '{}',
      };
    const bytes = Buffer.from(raw, event.isBase64Encoded ? 'base64' : 'utf8');
    if (bytes.length > MAX_SNAPSHOT_BYTES)
      return {
        statusCode: 413,
        headers: { 'cache-control': 'no-store' },
        body: '{}',
      };
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(event.headers)) {
      const name = key.toLowerCase();
      if (
        value !== undefined &&
        ![
          'host',
          'connection',
          'content-length',
          'transfer-encoding',
          'cookie',
          'x-tabmirror-source-ip',
        ].includes(name)
      )
        headers[name] = value;
    }
    headers.host = hostname;
    headers['x-tabmirror-source-ip'] = event.requestContext.http.sourceIp;
    if (event.cookies?.length) headers.cookie = event.cookies.join('; ');
    headers['content-length'] = String(bytes.length);
    const localPort = await port();
    return new Promise((resolve, reject) => {
      const upstream = request(
        {
          hostname: '127.0.0.1',
          port: localPort,
          path:
            event.rawPath +
            (event.rawQueryString ? `?${event.rawQueryString}` : ''),
          method: event.requestContext.http.method,
          headers,
        },
        (response) => {
          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_SNAPSHOT_BYTES + 128_000)
              response.destroy(Error('Response limit'));
            else chunks.push(Buffer.from(chunk));
          });
          response.on('error', reject);
          response.on('end', () => {
            const output: Record<string, string> = {};
            for (const [key, value] of Object.entries(response.headers))
              if (
                value !== undefined &&
                ![
                  'set-cookie',
                  'connection',
                  'transfer-encoding',
                  'content-length',
                ].includes(key)
              )
                output[key] = Array.isArray(value) ? value.join(', ') : value;
            resolve({
              statusCode: response.statusCode ?? 500,
              headers: output,
              cookies: response.headers['set-cookie'],
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
        },
      );
      upstream.setTimeout(25_000, () =>
        upstream.destroy(Error('Request timed out')),
      );
      upstream.on('error', reject);
      upstream.end(bytes);
    });
  };
}
