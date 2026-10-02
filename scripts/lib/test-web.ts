import { createServer, request } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
export function testWeb(apiPort: number) {
  return createServer(async (req, res) => {
    if (req.url?.startsWith('/api/')) {
      const upstream = request(
        {
          hostname: '127.0.0.1',
          port: apiPort,
          path: req.url,
          method: req.method,
          headers: req.headers,
        },
        (response) => {
          res.writeHead(response.statusCode!, response.headers);
          response.pipe(res);
        },
      );
      upstream.on('error', () => {
        res.writeHead(502);
        res.end();
      });
      req.pipe(upstream);
      return;
    }
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    const file =
      path === '/tabmirror.png' || /^\/assets\/[a-zA-Z0-9._-]+$/.test(path)
        ? path
        : '/index.html';
    try {
      res.writeHead(200, {
        'Content-Type':
          extname(file) === '.png'
            ? 'image/png'
            : extname(file) === '.js'
              ? 'text/javascript'
              : extname(file) === '.css'
                ? 'text/css'
                : 'text/html',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      });
      res.end(await readFile(resolve('apps/web/dist') + file));
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
}
