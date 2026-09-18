/** Same-origin transport, CSRF and retry keys. No DOM or page state dependencies. */
export function createApiClient({ fetchImpl = globalThis.fetch, makeKey = () => crypto.randomUUID(), onServerTime = () => {} } = {}) {
  let csrfToken = null;
  const retryKeys = new Map();

  async function request(path, { method = 'GET', data, key } = {}) {
    if (!path.startsWith('/api/')) throw new Error('Use a same-origin API path.');
    let response, body;
    try {
      response = await fetchImpl(path, { method, credentials: 'same-origin', cache: 'no-store',
        headers: method === 'POST' ? { 'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}), ...(key ? { 'Idempotency-Key': key } : {}) } : {},
        ...(method === 'POST' ? { body: JSON.stringify(data ?? {}) } : {}), signal: AbortSignal.timeout(12_000) });
      body = await response.json();
    } catch {
      throw new Error('Connection interrupted. Check that Taxi Ai is running, then retry the same action.');
    }
    if (!response.ok) {
      const error = new Error(body.error?.message ?? 'Unable to complete this request.');
      error.status = response.status;
      error.code = body.error?.code;
      throw error;
    }
    if (Number.isFinite(body.serverNow)) onServerTime(body.serverNow);
    return body;
  }

  async function rideCommand(path, data) {
    const fingerprint = `${path}:${JSON.stringify(data)}`;
    const key = retryKeys.get(fingerprint) ?? makeKey();
    retryKeys.set(fingerprint, key);
    try {
      const result = await request(path, { method: 'POST', data, key });
      retryKeys.delete(fingerprint);
      return result;
    } catch (error) {
      if (error.status && error.status < 500) retryKeys.delete(fingerprint);
      throw error;
    }
  }

  return Object.freeze({ request, rideCommand,
    setCsrf(token) { csrfToken = token; },
    reset() { csrfToken = null; retryKeys.clear(); },
  });
}
