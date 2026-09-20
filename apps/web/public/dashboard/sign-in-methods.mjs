import { googleDestination } from './google-auth.mjs';

export function createSignInMethods({ client, view, navigate }) {
  let generation = 0, account = null, connected = false, busy = false;
  function clear() { generation++; account = null; client.reset(); view.clear(); }
  async function load() {
    if (busy) return;
    clear(); const epoch = generation;
    try {
      const first = await client.request('/api/session');
      if (epoch !== generation) return;
      if (!first.user || first.user.role === 'admin') { view.status('Sign in to your customer or driver account to manage sign-in methods.'); return; }
      const result = await client.request('/api/account/sign-in-methods'), last = await client.request('/api/session');
      if (epoch !== generation) return;
      if (first.user.id !== last.user?.id || first.csrfToken !== last.csrfToken) { clear(); view.error('Your account changed. Refresh to continue.'); return; }
      account = first.user; connected = result.methods.google; client.setCsrf(last.csrfToken);
      view.render(account, result.methods, result.google.enabled);
    } catch (error) { if (epoch === generation) { clear(); view.error(error.message); } }
  }
  async function submit(password) {
    if (busy || !account) return;
    busy = true; view.busy(true); view.error(''); const epoch = generation;
    try {
      const result = await client.request(connected ? '/api/account/google/unlink' : '/api/account/google/link', { method: 'POST', data: { password } });
      if (epoch !== generation) return;
      if (connected) { clear(); view.status('Google disconnected. Your sessions have ended. Sign in again with your Taxi Ai password.'); }
      else navigate(googleDestination(result.redirectUrl));
    } catch (error) { if (epoch === generation) view.error(error.message); }
    finally { busy = false; view.busy(false); }
  }
  return Object.freeze({ load, submit, clear });
}
