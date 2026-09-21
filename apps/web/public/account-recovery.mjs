import { createApiClient } from './dashboard/api-client.mjs';
import { consumeEmailAction, createAccountRecovery } from './dashboard/account-recovery-controller.mjs';
const $ = (id) => document.getElementById(id);
const view = {
  mode(mode) {
    const request = mode === 'request', reset = mode === 'reset', verify = mode === 'verify';
    $('recovery-form').hidden = !(request || reset || verify);
    $('recovery-email-fields').hidden = !request; $('recovery-email').disabled = !request;
    $('recovery-password-fields').hidden = !reset;
    $('recovery-password').disabled = !reset; $('recovery-confirm').disabled = !reset;
    $('recovery-google').hidden = !request; $('recovery-new').hidden = mode !== 'invalid';
    $('recovery-title').textContent = request ? 'Let’s get you back in.' : reset ? 'A fresh start.' : verify ? 'Confirm your email.' : 'Open a new email link.';
    $('recovery-description').textContent = request ? 'Enter the email address you use for Taxi Ai.' : reset ? 'Choose a new password for your account.'
      : verify ? 'Choose Verify email to confirm this mailbox for your Taxi Ai account.' : 'This page no longer has a usable link. Reopen the latest email, or request another one.';
    $('recovery-submit').textContent = request ? 'Send reset email' : reset ? 'Save new password' : 'Verify email';
  },
  error(message) { $('recovery-error').textContent = message; },
  busy(value) { $('recovery-submit').disabled = value; $('recovery-form').setAttribute('aria-busy', String(value)); },
  clear() { $('recovery-form').reset(); },
  success(mode) {
    $('recovery-form').hidden = true; $('recovery-google').hidden = mode !== 'request'; $('recovery-new').hidden = false;
    $('recovery-title').textContent = mode === 'request' ? 'Check your inbox.' : mode === 'reset' ? 'Password updated.' : 'Email verified.';
    $('recovery-description').textContent = mode === 'request' ? 'If this address has a password account, we’ll email a reset link. Check spam, and wait a minute before requesting another.'
      : mode === 'reset' ? 'Your existing sessions have ended. Sign in again with your new password.' : 'Your email address is confirmed. Return to your account to continue.';
    $('recovery-status').textContent = mode === 'request' ? 'Request received.' : 'You’re all set.';
    $('recovery-title').focus();
  },
};
const controller = createAccountRecovery({ client: createApiClient(), view, initial: consumeEmailAction(location, history) });
$('recovery-form').addEventListener('submit', (event) => {
  event.preventDefault(); const password = $('recovery-password').value, confirmation = $('recovery-confirm').value;
  $('recovery-password').value = ''; $('recovery-confirm').value = '';
  void controller.submit({ email: $('recovery-email').value, password, confirmation });
});
document.addEventListener('visibilitychange', () => { if (document.hidden) { $('recovery-password').value = ''; $('recovery-confirm').value = ''; } });
window.addEventListener('pagehide', () => controller.clear());
void controller.load();
