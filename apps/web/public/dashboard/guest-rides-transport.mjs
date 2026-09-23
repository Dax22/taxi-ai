/** Verify cookie identity around private reads and before/after mutations, including cross-tab changes. */
export function createGuestRidesTransport({ client, identity, onChanged }) {
  const keyOf = (session) => session.user ? `${session.user.id}:${session.csrfToken}` : null;
  async function request(path, options) {
    try { return await client.request(path, options); }
    catch (error) { if ([401, 403].includes(error.status)) onChanged(); throw error; }
  }
  async function verify(expected) {
    const session = await request('/api/session');
    if (!expected || identity() !== expected || keyOf(session) !== expected) {
      onChanged(); const error = new Error('Your account changed. Refresh the dashboard before managing a passenger link.');
      error.status = 401; error.code = 'SESSION_CHANGED'; throw error;
    }
  }
  return Object.freeze({
    async request(path) {
      const expected = identity(), result = await request('/api' + path);
      await verify(expected); return result;
    },
    async command(path, data, key) {
      const expected = identity(); await verify(expected);
      const result = await request('/api' + path, { method: 'POST', data, key });
      await verify(expected); return result;
    },
  });
}
