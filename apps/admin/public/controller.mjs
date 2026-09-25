import { canAccess, defaultPage } from './navigation.mjs';

/** Fence every private read and action with the current account, role version and MFA session. */
export function createAdminController({ client, view, route, navigate = (path) => { window.location.assign(path); }, makeKey = () => crypto.randomUUID() }) {
  let generation = 0, abort = null, busy = false, acceptedIdentity = null, pending = null, lastSession = null, confirmationPending = false;
  const identity = (session) => `${session.user.id}:${session.csrfToken}:${session.staff?.version ?? ''}:${session.staff?.role ?? ''}:${[...(session.staff?.permissions ?? [])].sort().join(',')}:${session.staff?.mfa?.verifiedUntil ?? ''}`;
  const mfaNeeded = (session) => { const mfa = session.staff?.mfa; return mfa?.needsVerification === true || mfa && (mfa.required || mfa.enrolled) && !(mfa.verifiedUntil > (session.serverNow ?? Date.now())); };
  function cancel() { generation++; abort?.abort(); abort = null; busy = false; }
  function start() { cancel(); abort = new AbortController(); busy = true; view.clear(); view.loading(true); return { epoch: generation, signal: abort.signal }; }
  const changed = () => Object.assign(new Error('The signed-in account changed or staff access was updated. Sign in again to continue.'), { status: 403 });
  function check(session) { client.setCsrf(session.csrfToken); lastSession = session; if (mfaNeeded(session)) { pending = null; acceptedIdentity = null; view.mfa?.(session.staff.mfa); return false; } return true; }
  function fail(error, credentials = null) {
    acceptedIdentity = null;
    if (['MFA_REQUIRED', 'MFA_SETUP_REQUIRED', 'MFA_UNAVAILABLE'].includes(error.code)) { pending = null; view.mfa?.(lastSession?.staff?.mfa ?? {}); }
    else if ([401, 403].includes(error.status)) { pending = null; client.reset(); view.signIn(error.status === 401 && !credentials ? '' : error.message); }
    else view.error(error.name === 'AbortError' ? 'This request took too long. Try refreshing.' : error.message);
  }
  async function load(credentials = null) {
    if (busy) return;
    const { epoch, signal } = start();
    try {
      if (credentials) await client.login(credentials, signal);
      if (epoch !== generation) return;
      const first = await client.session(signal); if (epoch !== generation || !check(first)) return;
      if (route.permission && !canAccess(first.staff, route.permission)) {
        const home = defaultPage(first.staff);
        if (route.name === 'overview' && home && home !== '/admin') { navigate(home); return; }
        throw Object.assign(new Error('Your staff role does not have access to this page.'), { status: 403 });
      }
      const data = await client.request(route.apiPath, { signal }); if (epoch !== generation) return;
      const last = await client.session(signal); if (epoch !== generation) return;
      if (data.viewerId !== first.user.id || identity(first) !== identity(last)) throw changed();
      if (!check(last)) return;
      acceptedIdentity = identity(last); pending = null;
      view.render(route, data, last.user, last.staff);
    } catch (error) { if (epoch === generation) fail(error, credentials); }
    finally { if (epoch === generation) { busy = false; view.loading(false); } }
  }
  async function mutate(path, data, retry = false) {
    if (busy) return;
    if (!retry) pending = { path, data, key: makeKey(), identity: acceptedIdentity };
    if (!pending) return;
    const action = pending, { epoch, signal } = start(); let refresh = false;
    try {
      const first = await client.session(signal); if (epoch !== generation || !check(first)) return;
      if (!action.identity || identity(first) !== action.identity) throw changed();
      await client.request(action.path, { data: action.data, key: action.key, signal }); if (epoch !== generation) return;
      const last = await client.session(signal); if (epoch !== generation) return;
      if (identity(first) !== identity(last)) throw changed();
      pending = null; refresh = true;
    } catch (error) {
      if (epoch !== generation) return;
      if (!error.status || error.status >= 500) view.actionError?.('The action could not be confirmed. Retry the same action to check its result safely.');
      else { pending = null; fail(error); }
    } finally { if (epoch === generation) { busy = false; view.loading(false); } }
    if (refresh) await load();
  }
  return Object.freeze({ load, login: (credentials) => load(credentials), mutate,
    retry: () => pending ? mutate(pending.path, pending.data, true) : Promise.resolve(),
    async revalidate() {
      if (busy || pending || !acceptedIdentity) return;
      const epoch = generation;
      try { const next = await client.session(); if (epoch !== generation) return; if (identity(next) !== acceptedIdentity || mfaNeeded(next)) { cancel(); view.clear(); if (!check(next)) return; await load(); } }
      catch (error) { if (epoch === generation) { cancel(); view.clear(); fail(error); } }
    },
    async security() {
      if (busy) return;
      pending = null; const expected = acceptedIdentity;
      const { epoch, signal } = start();
      try {
        const session = await client.session(signal); if (epoch !== generation) return;
        if (expected && identity(session) !== expected) throw changed();
        client.setCsrf(session.csrfToken); lastSession = session; view.mfa?.(session.staff?.mfa ?? {});
      } catch (error) { if (epoch === generation) fail(error); }
      finally { if (epoch === generation) { busy = false; view.loading(false); } }
    },
    async mfa(action, data) {
      if (busy) return;
      const { epoch, signal } = start(); let complete = false;
      try {
        const first = await client.session(signal); if (epoch !== generation) return;
        if (!lastSession || identity(first) !== identity(lastSession)) throw changed();
        client.setCsrf(first.csrfToken);
        const result = await client.request('/api/admin/console/staff/mfa/' + action, { data, key: makeKey(), signal }); if (epoch !== generation) return;
        const last = await client.session(signal); if (epoch !== generation) return;
        if (first.user.id !== last.user.id || first.csrfToken !== last.csrfToken || first.staff?.version !== last.staff?.version || first.staff?.role !== last.staff?.role) throw changed();
        lastSession = last;
        if (action === 'enroll') { confirmationPending = true; view.mfa?.(last.staff.mfa, result.setup); }
        else { confirmationPending = false; complete = true; }
      } catch (error) { if (epoch === generation) { if ([401, 403].includes(error.status)) fail(error); else view.mfa?.(lastSession?.staff?.mfa ?? {}, confirmationPending ? { pending: true } : null, error.message); } }
      finally { if (epoch === generation) { busy = false; view.loading(false); } }
      if (complete) await load();
    },
    conceal() { cancel(); pending = null; acceptedIdentity = null; lastSession = null; confirmationPending = false; client.reset(); view.clear(); view.loading(true); },
    async logout() {
      cancel(); pending = null; acceptedIdentity = null; lastSession = null; confirmationPending = false; const epoch = generation; busy = true; view.clear(); view.loading(true); view.signIn('Signing out…');
      const result = client.logout(); client.reset();
      try { await result; if (epoch === generation) view.signIn('Signed out.'); }
      catch { if (epoch === generation) view.signIn('Server sign-out could not be confirmed. Reconnect and try signing out again.'); }
      finally { if (epoch === generation) { busy = false; view.loading(false); } }
    },
  });
}
