import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { openDatabase } from '../../services/api/src/infrastructure/database.mjs';
import { createApplication } from '../../services/api/src/application.mjs';
import { createApiRouter } from '../../services/api/src/http/router.mjs';
import { sendError } from '../../services/api/src/http/responses.mjs';
import { localOrigin } from '../../services/api/src/http/security.mjs';
import { createCallConfig } from '../../services/api/src/infrastructure/call-config.mjs';

// Explicit allowlist: never serve the repository root or arbitrary disk paths.
const routes = new Map([
  ['/', ['public/index.html', 'text/html; charset=utf-8']],
  ['/app', ['public/dashboard.html', 'text/html; charset=utf-8']],
  ['/dashboard.css', ['public/dashboard.css', 'text/css; charset=utf-8']],
  ['/dashboard.mjs', ['public/dashboard.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/api-client.mjs', ['public/dashboard/api-client.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/auth-form.mjs', ['public/dashboard/auth-form.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/dom.mjs', ['public/dashboard/dom.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/views.mjs', ['public/dashboard/views.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/trip-model.mjs', ['public/dashboard/trip-model.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/trip-view.mjs', ['public/dashboard/trip-view.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/call-media.mjs', ['public/dashboard/call-media.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/call-controller.mjs', ['public/dashboard/call-controller.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/call-view.mjs', ['public/dashboard/call-view.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/conversation-model.mjs', ['public/dashboard/conversation-model.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/conversation-controller.mjs', ['public/dashboard/conversation-controller.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/conversation-view.mjs', ['public/dashboard/conversation-view.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/chat-reports-view.mjs', ['public/dashboard/chat-reports-view.mjs', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['public/styles.css', 'text/css; charset=utf-8']],
  ['/app.mjs', ['public/app.mjs', 'text/javascript; charset=utf-8']],
  ['/favicon.svg', ['public/favicon.svg', 'image/svg+xml']],
  ['/assets/taxi-ai-mark.svg', ['public/assets/taxi-ai-mark.svg', 'image/svg+xml']],
  ['/assets/taxi-hero.webp', ['public/assets/taxi-hero.webp', 'image/webp']],
  ['/assets/autonomous.webp', ['public/assets/autonomous.webp', 'image/webp']],
  ['/shared/fare-negotiation.mjs', ['../../packages/shared/src/fare-negotiation.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/demo-booking.mjs', ['../../packages/shared/src/demo-booking.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/trip-lifecycle.mjs', ['../../packages/shared/src/trip-lifecycle.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/call-lifecycle.mjs', ['../../packages/shared/src/call-lifecycle.mjs', 'text/javascript; charset=utf-8']],
]);

export function createAppServer({ db = openDatabase(':memory:'), clock = Date.now, callConfig = createCallConfig() } = {}) {
  const application = createApplication({ db, clock, callConfig });
  const handleApi = createApiRouter(application);
  const cleanup = setInterval(() => {
    try { application.calls.sweep(); }
    catch { /* Request paths retry cleanup; never log SDP or credentials. */ }
  }, 5000);
  cleanup.unref();
  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    let pathname;
    try {
      pathname = new URL(request.url, 'http://localhost').pathname;
      response.setHeader('Permissions-Policy', `camera=(), microphone=${pathname === '/app' && callConfig.mode !== 'off' ? '(self)' : '()'}, geolocation=()`);
    } catch {
      response.writeHead(400);
      response.end('Bad request');
      return;
    }
    try {
      localOrigin(request);
      if (pathname.startsWith('/api/')) {
        await handleApi({ request, response, pathname });
        return;
      }
    } catch (error) {
      sendError(response, error);
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end('Method not allowed');
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
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.on('close', () => { clearInterval(cleanup); db.close(); });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('PORT must be an integer between 1 and 65535.');
    process.exitCode = 1;
  } else {
    const server = createAppServer({ db: openDatabase() });
    server.on('error', (error) => {
      console.error(error.code === 'EADDRINUSE'
        ? `Port ${port} is busy. Try: PORT=3001 npm run dev`
        : `Could not start Taxi Ai: ${error.message}`);
      process.exitCode = 1;
    });
    server.listen(port, '127.0.0.1', () => {
      console.log(`Taxi Ai: http://localhost:${port} — accounts and ride requests at /app`);
      console.log('Local development only. Requests are saved on this computer. No real dispatch or payments.');
      console.log('Press Ctrl+C to stop.');
    });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
  }
}
