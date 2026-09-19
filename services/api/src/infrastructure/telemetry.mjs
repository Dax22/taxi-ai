import { randomUUID } from 'node:crypto';

const category = (path) => path.startsWith('/health/') ? 'health'
  : /^\/api\/(auth|session)(\/|$)/.test(path) ? 'account'
    : /^\/api\/(rides|calls|locations|location-shares|availability|chat|admin)(\/|$)/.test(path) ? 'application'
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
    event(name) { if (['server_started', 'server_stopping', 'maintenance_failed', 'server_failed', 'shutdown_timeout'].includes(name)) emit({ event: name, at: new Date().toISOString() }); },
  });
}
