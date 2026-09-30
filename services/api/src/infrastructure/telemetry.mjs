import { randomUUID } from 'node:crypto';

const category = (path) => path.startsWith('/health/') ? 'health'
  : path.startsWith('/api/mobile/v1/') ? 'mobile' : /^\/api\/(auth|session)(\/|$)/.test(path) ? 'account'
    : /^\/api\/(rides|calls|locations|location-shares|availability|chat|admin|payments|driver|safety|trip-share)(\/|$)/.test(path) ? 'application'
      : path.startsWith('/api/') ? 'unknown_api' : 'web';

/** Allowlisted operational fields only: never log URLs, headers, bodies or errors. */
export function createTelemetry({ write = (line) => process.stdout.write(line + '\n'), enabled = true } = {}) {
  function emit(value) { if (enabled) { try { write(JSON.stringify(value)); } catch { /* Logging cannot break a request. */ } } }
  return Object.freeze({
    observe(request, response, pathname) {
      const id = randomUUID(), started = performance.now();
      response.setHeader('X-Request-ID', id);
      response.once('finish', () => emit({ event: 'http_request', at: new Date().toISOString(), requestId: id,
        method: ['GET', 'POST', 'HEAD', 'OPTIONS', 'DELETE', 'PUT', 'PATCH'].includes(request.method) ? request.method : 'OTHER',
        category: category(pathname()), status: response.statusCode, durationMs: Math.round(performance.now() - started) }));
    },
    dispatchProfile(value) {
      const number = (n) => Number.isFinite(n) && n >= 0 ? n : 0;
      emit({ event: 'dispatch_profile', at: new Date().toISOString(),
        ...Object.fromEntries(['durationMs', 'sampleEvery', 'queryCount', 'queryMs', 'queryErrors', 'transactions', 'retries'].map((key) => [key, number(value[key])])),
        failed: value.failed === true,
        phases: Object.fromEntries(['discovery', 'routing', 'commit'].filter((key) => value.phases?.[key] !== undefined).map((key) => [key, number(value.phases[key])])),
        queries: (Array.isArray(value.queries) ? value.queries : []).slice(0, 65).filter((row) => /^(?:[a-f0-9]{16}|overflow)$/.test(row.fingerprint)).map((row) => ({
          fingerprint: row.fingerprint, ...Object.fromEntries(['count', 'totalMs', 'maxMs', 'errors'].map((key) => [key, number(row[key])])) })),
      });
    },
    event(name) { if (['server_started', 'server_stopping', 'maintenance_failed', 'server_failed', 'shutdown_timeout'].includes(name)) emit({ event: name, at: new Date().toISOString() }); },
  });
}
