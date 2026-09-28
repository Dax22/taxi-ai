import { createApiClient } from './dashboard/api-client.mjs';
import { createSignInMethods } from './dashboard/sign-in-methods.mjs';
import { consumeGoogleOutcome } from './dashboard/google-auth.mjs';
const $ = (id) => document.getElementById(id);
const view = {
  clear() { $('access-private').hidden = true; $('access-form').reset(); $('access-email').textContent = ''; $('access-password-status').textContent = ''; $('access-google-status').textContent = ''; $('access-verification-status').textContent = ''; $('access-verification-help').textContent = ''; $('access-notice').textContent = ''; },
  status(value) { $('access-status').textContent = value; },
  error(value) { $('access-error').textContent = value; },
  notice(value) { $('access-notice').textContent = value; },
  busy(value) { $('access-submit').disabled = value; $('access-refresh').disabled = value; $('access-password').disabled = value; $('access-verify').disabled = value; },
  render(account, methods, enabled, email) {
    $('access-status').textContent = ''; $('access-error').textContent = ''; $('access-private').hidden = false;
    $('access-email').textContent = account.email;
    $('access-verification-status').textContent = email.verified ? 'Email verified' : 'Email not yet verified';
    $('access-verification-help').textContent = email.verified ? 'This confirms your mailbox. Driver approval is a separate step.'
      : email.enabled ? 'Confirm your mailbox using the link we send. Check spam, then return here and refresh.' : 'Email delivery is being set up. You can continue using the preview.';
    $('access-verify').hidden = email.verified || !email.enabled;
    $('access-password-status').textContent = methods.password ? 'Available' : 'Not set up';
    $('access-google-status').textContent = methods.google ? 'Connected' : enabled ? 'Ready to connect' : 'Coming soon';
    $('access-only-google').hidden = methods.password || !methods.google;
    $('access-form').hidden = !methods.password || (!methods.google && !enabled);
    $('access-submit').textContent = methods.google ? 'Disconnect Google' : 'Connect Google';
    $('access-help').textContent = methods.google ? 'Disconnecting signs out your current sessions and mobile devices. Your Taxi Ai password will still work.'
      : 'Next, choose the Google account with the same email address. Your trips and driver profile will stay here.';
  },
};
const controller = createSignInMethods({ client: createApiClient(), view, navigate: (url) => location.assign(url) });
const googleOutcome = consumeGoogleOutcome(location, history);
$('access-form').addEventListener('submit', (event) => { event.preventDefault(); const password = $('access-password').value; $('access-password').value = ''; void controller.submit(password); });
$('access-refresh').addEventListener('click', () => void controller.load());
$('access-verify').addEventListener('click', () => void controller.verify());
document.addEventListener('visibilitychange', () => { if (document.hidden) controller.clear(); else void controller.load(); });
window.addEventListener('pagehide', () => controller.clear());
window.addEventListener('pageshow', (event) => { if (event.persisted) void controller.load(); });
void controller.load().then(() => { if (!document.hidden && googleOutcome) $('access-notice').textContent = googleOutcome; });
