import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { openDatabase } from '../../services/api/src/infrastructure/database.mjs';
import { createApplication } from '../../services/api/src/application.mjs';
import { createMobileRouter } from '../../services/api/src/http/mobile-router.mjs';
import { createApiRouter } from '../../services/api/src/http/router.mjs';
import { sendError, json } from '../../services/api/src/http/responses.mjs';
import { requestContext, requireStagingAccess, isInternalHealth } from '../../services/api/src/http/security.mjs';
import { createCallConfig } from '../../services/api/src/infrastructure/call-config.mjs';
import { createMapProvider } from '../../services/api/src/infrastructure/map-provider.mjs';
import { createRuntimeConfig } from '../../services/api/src/infrastructure/runtime-config.mjs';
import { createHealth } from '../../services/api/src/infrastructure/health.mjs';
import { createTelemetry } from '../../services/api/src/infrastructure/telemetry.mjs';
import { VEHICLE_COLOURS } from '../../packages/shared/src/vehicle-profile.mjs';
import { check } from '../../services/api/src/shared/errors.mjs';

// Explicit allowlist: never serve the repository root or arbitrary disk paths.
const routes = new Map([
  ['/', ['public/index.html', 'text/html; charset=utf-8']],
  ['/devices', ['public/devices.html', 'text/html; charset=utf-8']],
  ['/devices.mjs', ['public/devices.mjs', 'text/javascript; charset=utf-8']],
  ['/download.mjs', ['public/download.mjs', 'text/javascript; charset=utf-8']],
  ['/app-release.mjs', ['public/app-release.mjs', 'text/javascript; charset=utf-8']],
  ['/app', ['public/dashboard.html', 'text/html; charset=utf-8']],
  ['/trip-share', ['public/trip-share.html', 'text/html; charset=utf-8']],
  ['/trip-share.mjs', ['public/trip-share.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/safety-controller.mjs', ['public/dashboard/safety-controller.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/safety-view.mjs', ['public/dashboard/safety-view.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/safety-format.mjs', ['public/dashboard/safety-format.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/trip-share-controller.mjs', ['public/dashboard/trip-share-controller.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/safety.mjs', ['../../packages/shared/src/safety.mjs', 'text/javascript; charset=utf-8']],
  ['/vehicle.css', ['public/vehicle.css', 'text/css; charset=utf-8']],
  ['/dashboard/vehicle-card.mjs', ['public/dashboard/vehicle-card.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/vehicle-profile.mjs', ['../../packages/shared/src/vehicle-profile.mjs', 'text/javascript; charset=utf-8']],
  ...[...VEHICLE_COLOURS.map((c) => c.id), 'neutral'].map((id) => [`/assets/vehicles/sedan-${id}.svg`, [`public/assets/vehicles/sedan-${id}.svg`, 'image/svg+xml']]),
  ['/dashboard.css', ['public/dashboard.css', 'text/css; charset=utf-8']],
  ['/dashboard/account-mode-view.mjs', ['public/dashboard/account-mode-view.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/account-modes.mjs', ['../../packages/shared/src/account-modes.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard.mjs', ['public/dashboard.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/onboarding-controller.mjs', ['public/dashboard/onboarding-controller.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/onboarding-view.mjs', ['public/dashboard/onboarding-view.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/driver-files.mjs', ['public/dashboard/driver-files.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/api-client.mjs', ['public/dashboard/api-client.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/page-controller.mjs', ['public/dashboard/page-controller.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/auth-form.mjs', ['public/dashboard/auth-form.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/dom.mjs', ['public/dashboard/dom.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/views.mjs', ['public/dashboard/views.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/trip-model.mjs', ['public/dashboard/trip-model.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/trip-view.mjs', ['public/dashboard/trip-view.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/call-media.mjs', ['public/dashboard/call-media.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/call-controller.mjs', ['public/dashboard/call-controller.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/call-view.mjs', ['public/dashboard/call-view.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/map-view.mjs', ['public/dashboard/map-view.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/location-planner.mjs', ['public/dashboard/location-planner.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/location-view.mjs', ['public/dashboard/location-view.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/location-sharing.mjs', ['public/dashboard/location-sharing.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/availability-controller.mjs', ['public/dashboard/availability-controller.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/availability-view.mjs', ['public/dashboard/availability-view.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/payments-controller.mjs', ['public/dashboard/payments-controller.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/payments-view.mjs', ['public/dashboard/payments-view.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/geolocation.mjs', ['public/dashboard/geolocation.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/conversation-model.mjs', ['public/dashboard/conversation-model.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/conversation-controller.mjs', ['public/dashboard/conversation-controller.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/conversation-view.mjs', ['public/dashboard/conversation-view.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard/chat-reports-view.mjs', ['public/dashboard/chat-reports-view.mjs', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['public/styles.css', 'text/css; charset=utf-8']],
  ['/homepage.css', ['public/homepage.css', 'text/css; charset=utf-8']],
  ['/app.mjs', ['public/app.mjs', 'text/javascript; charset=utf-8']],
  ['/favicon.svg', ['public/favicon.svg', 'image/svg+xml']],
  ['/assets/taxi-ai-mark.svg', ['public/assets/taxi-ai-mark.svg', 'image/svg+xml']],
  ['/assets/city-route-hero.webp', ['public/assets/city-route-hero.webp', 'image/webp']],
  ['/assets/city-route-hero-small.webp', ['public/assets/city-route-hero-small.webp', 'image/webp']],
  ['/assets/autonomous-concept.webp', ['public/assets/autonomous-concept.webp', 'image/webp']],
  ['/assets/autonomous-concept-small.webp', ['public/assets/autonomous-concept-small.webp', 'image/webp']],
  ['/shared/driver-onboarding.mjs', ['../../packages/shared/src/driver-onboarding.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/fare-negotiation.mjs', ['../../packages/shared/src/fare-negotiation.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/demo-booking.mjs', ['../../packages/shared/src/demo-booking.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/trip-lifecycle.mjs', ['../../packages/shared/src/trip-lifecycle.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/call-lifecycle.mjs', ['../../packages/shared/src/call-lifecycle.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/matching.mjs', ['../../packages/shared/src/matching.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/payments.mjs', ['../../packages/shared/src/payments.mjs', 'text/javascript; charset=utf-8']],
  ['/shared/locations.mjs', ['../../packages/shared/src/locations.mjs', 'text/javascript; charset=utf-8']],
]);

export function createAppServer({ runtime = createRuntimeConfig({}), db = openDatabase(runtime.mode === 'staging' ? runtime.database : ':memory:'),
  clock = Date.now, callConfig = createCallConfig({ ...process.env, TAXI_AI_CALLS_MODE: process.env.TAXI_AI_CALLS_MODE ?? (runtime.mode === 'staging' ? 'off' : 'local') }),
  mapProvider = createMapProvider({ env: { ...process.env, TAXI_AI_MAPS_MODE: process.env.TAXI_AI_MAPS_MODE ?? (runtime.mode === 'staging' ? 'off' : 'community') } }),
  telemetry = createTelemetry({ enabled: runtime.mode === 'staging' }) } = {}) {
  if (runtime.mode === 'staging' && callConfig.mode === 'local') throw new Error('Staging calls require off or a configured relay.');
  const application = createApplication({ db, clock, callConfig, mapProvider, allowSimulation: runtime.mode === 'local' });
  const handleApi = createApiRouter(application, { secure: runtime.mode === 'staging' });
  const handleMobile = createMobileRouter(application);
  const health = createHealth(db);
  const cleanup = setInterval(() => {
    try { application.rides.sweep(); application.availability.sweep(); application.calls.sweep(); application.locations.sweep(); application.safety.sweep(); application.devices.sweep(); }
    catch { telemetry.event('maintenance_failed'); }
  }, 5000);
  cleanup.unref();
  const server = createServer(async (request, response) => {
    let pathname = '';
    telemetry.observe(request, response, () => pathname);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    if (runtime.mode === 'staging') response.setHeader('Strict-Transport-Security', 'max-age=86400');
    response.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'${mapProvider.mode === 'off' ? '' : ` ${mapProvider.tileOrigin}`}; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
    try {
      pathname = new URL(request.url, 'http://localhost').pathname;
      if (pathname === '/app' && mapProvider.mode !== 'off') response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      response.setHeader('Permissions-Policy', `camera=(), microphone=${pathname === '/app' && callConfig.mode !== 'off' ? '(self)' : '()'}, geolocation=${pathname === '/app' ? '(self)' : '()'}`);
    } catch {
      response.writeHead(400);
      response.end('Bad request');
      return;
    }
    try {
      let context;
      if (!isInternalHealth(request, pathname)) {
        context = requestContext(request, runtime);
        requireStagingAccess(request, response, runtime, pathname);
      }
      if (['/health/live', '/health/ready'].includes(pathname)) {
        check(['GET', 'HEAD'].includes(request.method), 'METHOD_NOT_ALLOWED', 'Use GET or HEAD.');
        const ok = pathname === '/health/live' || health.ready();
        if (request.method === 'HEAD') { response.writeHead(ok ? 200 : 503); response.end(); }
        else json(response, ok ? 200 : 503, { status: ok ? pathname === '/health/live' ? 'alive' : 'ready' : 'unavailable' });
        return;
      }
      check(!health.draining(), 'SERVER_DRAINING', 'Taxi Ai is restarting. Please retry shortly.');
      if (pathname.startsWith('/api/')) {
        await (pathname.startsWith('/api/mobile/v1/') ? handleMobile : handleApi)({ request, response, pathname, ...context });
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
  server.beginShutdown = () => { health.beginShutdown(); clearInterval(cleanup); };
  server.on('close', () => { clearInterval(cleanup); db.close(); });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let db;
  try {
    const runtime = createRuntimeConfig();
    const telemetry = createTelemetry();
    db = openDatabase(runtime.database);
    const server = createAppServer({ runtime, db, telemetry });
    server.on('error', (error) => {
      telemetry.event('server_failed');
      console.error(error.code === 'EADDRINUSE' ? 'Taxi Ai port is already in use.' : 'Unable to listen on the configured address.');
      db.close();
      process.exitCode = 1;
    });
    server.listen(runtime.port, runtime.host, () => {
      telemetry.event('server_started');
      if (runtime.mode === 'local') console.log(`Taxi Ai: http://localhost:${runtime.port}/app — development preview. Press Ctrl+C to stop.`);
    });
    let stopping = false;
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
      if (stopping) return; stopping = true;
      telemetry.event('server_stopping'); server.beginShutdown();
      const deadline = setTimeout(() => { telemetry.event('shutdown_timeout'); server.closeAllConnections(); process.exitCode = 1; }, 20_000);
      deadline.unref();
      server.close(() => clearTimeout(deadline));
    });
  } catch {
    db?.close();
    console.error('Taxi Ai could not start. Check runtime configuration and storage permissions; run npm run config:check for configuration errors.');
    process.exitCode = 1;
  }
}
