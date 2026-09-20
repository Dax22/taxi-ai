/** Discard old page reads after sign-out, account changes or backgrounding. */
export function createAdminController({ client, view, route }) {
  let generation = 0, abort = null, busy = false;
  const identity = (session) => `${session.user.id}:${session.csrfToken}`;
  function cancel() { generation++; abort?.abort(); abort = null; busy = false; }
  async function load(credentials = null) {
    if (busy) return;
    cancel(); const epoch = generation; abort = new AbortController(); const signal = abort.signal;
    busy = true; view.clear(); view.loading(true);
    try {
      if (credentials) await client.login(credentials, signal);
      if (epoch !== generation) return;
      const first = await client.session(signal); if (epoch !== generation) return;
      client.setCsrf(first.csrfToken);
      const data = await client.request(route.apiPath, { signal }); if (epoch !== generation) return;
      const last = await client.session(signal); if (epoch !== generation) return;
      if (data.viewerId !== first.user.id || identity(first) !== identity(last)) throw Object.assign(new Error('The signed-in account changed. Sign in again to continue.'), { status: 403 });
      client.setCsrf(last.csrfToken);
      view.render(route, data, last.user);
    } catch (error) {
      if (epoch !== generation) return;
      if ([401, 403].includes(error.status)) { client.reset(); view.signIn(error.status === 401 && !credentials ? '' : error.message); }
      else view.error(error.name === 'AbortError' ? 'This request took too long. Try refreshing.' : error.message);
    } finally { if (epoch === generation) { busy = false; view.loading(false); } }
  }
  return Object.freeze({ load, login: (credentials) => load(credentials),
    conceal() { cancel(); client.reset(); view.clear(); view.loading(true); },
    async logout() {
      cancel(); const epoch = generation; busy = true; view.clear(); view.loading(true); view.signIn('Signing out…');
      const result = client.logout(); client.reset();
      try { await result; if (epoch === generation) view.signIn('Signed out.'); }
      catch { if (epoch === generation) view.signIn('Server sign-out could not be confirmed. Reconnect and try signing out again.'); }
      finally { if (epoch === generation) { busy = false; view.loading(false); } }
    },
  });
}
