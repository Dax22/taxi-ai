/** Same-origin transport, CSRF and retry keys. No DOM or page state dependencies. */
export function createApiClient({ fetchImpl = globalThis.fetch, makeKey = () => crypto.randomUUID(), onServerTime = () => {} } = {}) {
  let csrfToken = null, generation = 0, mode = '', writes = 0;
  const retryKeys = new Map();

  async function request(path, { method = 'GET', data, key, callClient, locationClient, availabilityClient, signal } = {}) {
    if (!path.startsWith('/api/')) throw new Error('Use a same-origin API path.');
    const epoch = generation;
    const abort = new AbortController(), cancel = () => abort.abort();
    const timeout = setTimeout(cancel, path === '/api/driver/application/face-check' ? 45_000
      : path.startsWith('/api/events?') ? 30_000 : path.startsWith('/api/vehicle-checks/') || /^\/api\/eats\/stores\/[a-f0-9-]{36}\/(photo|assets|menu)$/.test(path) ? 35_000 : 12_000);
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    if (method === 'POST') writes++;
    let response, body;
    try {
      response = await fetchImpl(path, { method, credentials: 'same-origin', cache: 'no-store',
        headers: { ...(callClient ? { 'X-Call-Client': callClient } : {}),
          ...(locationClient ? { 'X-Location-Client': locationClient } : {}),
          ...(availabilityClient ? { 'X-Availability-Client': availabilityClient } : {}),
          ...(method === 'POST' ? { 'Content-Type': 'application/json',
            ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}), ...(key ? { 'Idempotency-Key': key } : {}) } : {}) },
        ...(method === 'POST' ? { body: JSON.stringify(data ?? {}) } : {}), signal: abort.signal });
      body = await response.json();
    } catch {
      if (epoch !== generation) throw changedSession();
      throw new Error('Connection interrupted. Check that Taxi Ai is running, then retry the same action.');
    } finally { clearTimeout(timeout); signal?.removeEventListener('abort', cancel); if (method === 'POST') writes--; }
    if (epoch !== generation) throw changedSession();
    if (!response.ok) {
      const error = new Error(body.error?.message ?? 'Unable to complete this request.');
      error.status = response.status;
      error.code = body.error?.code;
      throw error;
    }
    if (Number.isFinite(body.serverNow)) onServerTime(body.serverNow);
    return body;
  }

  async function command(path, data, { callClient, locationClient, availabilityClient } = {}) {
    const fingerprint = `${mode}:${callClient ?? ''}:${locationClient ?? ''}:${availabilityClient ?? ''}:${path}:${JSON.stringify(data)}`;
    const key = retryKeys.get(fingerprint) ?? makeKey();
    retryKeys.set(fingerprint, key);
    try {
      const result = await request(path, { method: 'POST', data, key, callClient, locationClient, availabilityClient });
      if (retryKeys.get(fingerprint) === key) retryKeys.delete(fingerprint);
      return result;
    } catch (error) {
      if (error.status && error.status < 500 && retryKeys.get(fingerprint) === key) retryKeys.delete(fingerprint);
      throw error;
    }
  }

  return Object.freeze({ request, command, rideCommand: command,
    setCsrf(token) { csrfToken = token; },
    pendingWrites: () => writes > 0,
    setMode(value) {
      if (mode === value) return;
      if (writes) throw new Error('Wait for the current action to finish before changing mode.');
      generation++; mode = value;
      // Retain uncertain retry keys in their original mode until a same-action retry.
    },
    reset() { generation++; mode = ''; csrfToken = null; retryKeys.clear(); },
  });
}

function changedSession() {
  const error = new Error('Your session changed. Review this screen and try again.');
  error.code = 'SESSION_CHANGED';
  return error;
}
