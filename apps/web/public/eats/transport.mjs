/** Recheck cookie identity around private reads and before writes, including other-tab sign-in changes. */
export function createEatsTransport({ client, identity, onChanged }) {
  const keyOf = (session) => session.user ? `${session.user.id}:${session.csrfToken}` : null;
  async function request(path, options) {
    try { return await client.request(path, options); }
    catch (error) { if (error.status === 401) onChanged(); throw error; }
  }
  async function session(expected) {
    const current = await request('/api/session');
    if (!expected || keyOf(current) !== expected || identity() !== expected) {
      onChanged(); const error = new Error('Your account changed. Sign in again or refresh Eats.'); error.status = 401; error.code = 'SESSION_CHANGED'; throw error;
    }
  }
  return Object.freeze({
    async request(path, options) {
      const expected = identity(); if (options?.method === 'POST') await session(expected);
      const result = await request('/api' + path, options);
      await session(expected); return result;
    },
    async command(path, data, key, options) {
      const expected = identity(); await session(expected);
      let result;
      if (key) result = await request('/api' + path, { method: 'POST', data, key, ...options });
      else {
        try { result = await client.command('/api' + path, data, options); }
        catch (error) { if (error.status === 401) onChanged(); throw error; }
      }
      await session(expected); return result;
    },
  });
}
