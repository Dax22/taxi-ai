export class AdminApiError extends Error {
  constructor(message, status = 0, code = null) { super(message); this.status = status; this.code = code; }
}
/** Cookie credentials and CSRF stay in this client; no browser storage or analytics SDK. */
export function createAdminClient({ fetchImpl = fetch } = {}) {
  let csrf = null;
  async function request(path, { data, signal, key } = {}) {
    if (!(path.startsWith('/api/admin/console/') || path === '/api/auth/logout')) throw new Error('Unsupported staff endpoint.');
    const timeout = new AbortController(), expired = setTimeout(() => timeout.abort(), 15000);
    try {
      const response = await fetchImpl(path, { method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        signal: signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal,
        headers: { Accept: 'application/json', ...(data === undefined ? {} : { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}) }) },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
      const body = await response.json();
      if (!response.ok) throw new AdminApiError(body.error?.message ?? 'Unable to load the dashboard.', response.status, body.error?.code);
      return body;
    } finally { clearTimeout(expired); }
  }
  return Object.freeze({
    request,
    session: (signal) => request('/api/admin/console/session', { signal }),
    setCsrf(value) { csrf = value; },
    login: (data, signal) => request('/api/admin/console/login', { data, signal }),
    logout: () => request('/api/auth/logout', { data: {} }),
    reset() { csrf = null; },
  });
}
