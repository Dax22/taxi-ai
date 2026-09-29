export const GOOGLE_MESSAGES = Object.freeze({
  cancelled: 'Google sign-in was cancelled. You can try again or use your password.',
  existing: 'You already have a Taxi Ai account. Sign in with your password, then open Sign-in methods to connect Google.',
  conflict: 'That Google account could not be connected. Use the Google account with your Taxi Ai email address.',
  session: 'Your Taxi Ai session ended. Sign in again before connecting Google.',
  staff: 'Use your separate administrator email and password for staff access.',
  retry: 'Google sign-in could not finish. Please start again.',
  connected: 'Google is now connected to your Taxi Ai account.',
  success: 'You’re signed in with Google.',
});

export function googleDestination(value) {
  const url = new URL(value);
  if (url.origin !== 'https://accounts.google.com' || url.pathname !== '/o/oauth2/v2/auth' || url.username || url.password) {
    throw new Error('Google sign-in could not start. Please try again.');
  }
  return url.href;
}

/** Small login controller. The API client owns networking; the caller owns DOM. */
export function createGoogleSignIn({ client, view, navigate }) {
  let enabled = false, busy = false;
  return Object.freeze({
    async load() {
      try { enabled = (await client.request('/api/auth/providers')).google?.enabled === true; }
      catch { enabled = false; }
      view.available(enabled);
    },
    async start(intent = null) {
      if (!enabled || busy) return;
      busy = true; view.busy(true); view.error('');
      try { const result = await client.request('/api/auth/google/start', { method: 'POST', data: intent ? { intent } : {} }); navigate(googleDestination(result.redirectUrl)); }
      catch (error) { view.error(error.message); busy = false; view.busy(false); }
    },
  });
}

export function consumeGoogleOutcome(location, history) {
  const url = new URL(location.href), outcome = url.searchParams.get('google');
  if (outcome === null) return '';
  url.searchParams.delete('google'); history.replaceState(null, '', url.pathname + url.search + url.hash);
  return GOOGLE_MESSAGES[outcome] ?? GOOGLE_MESSAGES.retry;
}
