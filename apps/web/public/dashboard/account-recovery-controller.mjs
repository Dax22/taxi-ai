/** Remove bearer links from history immediately; keep them only in this page's memory. */
export function consumeEmailAction(location, history) {
  const url = new URL(location.href), match = url.hash.match(/^#(reset|verify)=([a-f0-9]{64})$/);
  const result = match ? { mode: match[1], token: match[2] } : { mode: url.hash ? 'invalid' : 'request', token: null };
  history.replaceState(null, '', '/account-recovery');
  return result;
}

export function createAccountRecovery({ client, view, initial }) {
  let mode = initial.mode, token = initial.token, busy = false, generation = 0, enabled = false;
  initial.token = null;
  async function load() {
    const epoch = generation; view.mode(mode);
    if (mode !== 'request') return;
    view.busy(true);
    try {
      const settings = await client.request('/api/auth/email-settings');
      if (epoch !== generation) return;
      enabled = settings.enabled === true;
      if (!enabled) view.error('Account emails are not available yet. Please try again once email delivery is enabled.');
    } catch (error) { if (epoch === generation) view.error(error.message); }
    finally { if (epoch === generation) view.busy(!enabled); }
  }
  async function submit({ email, password, confirmation } = {}) {
    if (busy || !['request', 'reset', 'verify'].includes(mode) || (mode === 'request' && !enabled)) return;
    view.error('');
    if (mode === 'reset' && password !== confirmation) { view.error('Your passwords do not match. Enter them again.'); return; }
    busy = true; view.busy(true); const epoch = generation;
    const path = mode === 'request' ? '/api/auth/password/request' : mode === 'reset' ? '/api/auth/password/reset' : '/api/auth/email/verify';
    const data = mode === 'request' ? { email } : mode === 'reset' ? { token, password } : { token };
    try {
      await client.request(path, { method: 'POST', data });
      if (epoch !== generation) return;
      const completed = mode; mode = 'complete'; token = null; view.clear(); view.success(completed);
    } catch (error) {
      if (epoch !== generation) return;
      if (error.code === 'INVALID_EMAIL_LINK') { mode = 'invalid'; token = null; view.clear(); view.mode(mode); }
      view.error(error.message);
    } finally { busy = false; if (epoch === generation) view.busy(false); }
  }
  function clear() { generation++; token = null; mode = 'invalid'; client.reset(); view.clear(); view.mode(mode); }
  return Object.freeze({ load, submit, clear });
}
