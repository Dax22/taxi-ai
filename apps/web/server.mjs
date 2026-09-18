import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Explicit allowlist: never serve the repository root or arbitrary disk paths.
const routes = new Map([
  ['/', ['public/index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['public/styles.css', 'text/css; charset=utf-8']],
  ['/app.mjs', ['public/app.mjs', 'text/javascript; charset=utf-8']],
  ['/favicon.svg', ['public/favicon.svg', 'image/svg+xml']],
  ['/assets/taxi-hero.webp', ['public/assets/taxi-hero.webp', 'image/webp']],
  ['/assets/autonomous.webp', ['public/assets/autonomous.webp', 'image/webp']],
  ['/shared/fare-negotiation.mjs', ['../../packages/shared/src/fare-negotiation.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/demo-booking.mjs', ['../../packages/shared/src/demo-booking.mjs', 'text/javascript; charset=utf-8']],
]);

export function createDemoServer() {
  return createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end('Method not allowed');
      return;
    }
    let pathname;
    try {
      pathname = new URL(request.url, 'http://localhost').pathname;
    } catch {
      response.writeHead(400);
      response.end('Bad request');
      return;
    }
    const route = routes.get(pathname);
    if (!route) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : 'Not found');
      return;
    }
    try {
      const body = await readFile(new URL(route[0], import.meta.url));
      response.writeHead(200, { 'Content-Type': route[1], 'Content-Length': body.length });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch {
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : 'Unable to load this page');
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('PORT must be an integer between 1 and 65535.');
    process.exitCode = 1;
  } else {
    const server = createDemoServer();
    server.on('error', (error) => {
      console.error(error.code === 'EADDRINUSE'
        ? `Port ${port} is busy. Try: PORT=3001 npm run dev`
        : `Could not start the demo: ${error.message}`);
      process.exitCode = 1;
    });
    server.listen(port, '127.0.0.1', () => {
      console.log(`Taxi Ai web demo: http://localhost:${port}`);
      console.log('Local preview only. No real bookings or payments. Press Ctrl+C to stop.');
    });
  }
}
