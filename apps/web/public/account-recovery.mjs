import { createApiClient } from './dashboard/api-client.mjs';
import { consumeEmailAction, createAccountRecovery } from './dashboard/account-recovery-controller.mjs';
const $ = (id) => document.getElementById(id);

function setPasswordVisible(inputId, buttonId, visible) {
  const input = $(inputId), button = $(buttonId);
  input.type = visible ? 'text' : 'password';
  button.setAttribute('aria-pressed', String(visible));
  button.textContent = visible ? 'Hide' : 'Show';
}
function hidePasswords() {
  setPasswordVisible('recovery-password', 'recovery-password-toggle', false);
  setPasswordVisible('recovery-confirm', 'recovery-confirm-toggle', false);
}
function clearPasswords() {
  $('recovery-password').value = '';
  $('recovery-confirm').value = '';
  hidePasswords();
}

const view = {
  mode(mode) {
    const request = mode === 'request', reset = mode === 'reset', verify = mode === 'verify';
    $('recovery-form').hidden = !(request || reset || verify);
    $('recovery-email-fields').hidden = !request; $('recovery-email').disabled = !request;
    $('recovery-password-fields').hidden = !reset;
    $('recovery-password').disabled = !reset; $('recovery-confirm').disabled = !reset;
    $('recovery-password-toggle').disabled = !reset; $('recovery-confirm-toggle').disabled = !reset;
    $('recovery-google').hidden = !request; $('recovery-new').hidden = mode !== 'invalid';
    $('recovery-success-icon').hidden = true;
    $('recovery-status').textContent = '';
    $('recovery-title').textContent = request ? 'Let’s get you back in.' : reset ? 'A fresh start.' : verify ? 'Confirm your email.' : 'Open a new email link.';
    $('recovery-description').textContent = request ? 'Enter the email address you use for Taxi Ai. We’ll send instructions if this account can be recovered by password.'
      : reset ? 'Choose a new password for your account.'
      : verify ? 'Choose Verify email to confirm this mailbox for your Taxi Ai account.'
      : 'This page no longer has a usable link. Reopen the latest email, or request another one.';
    $('recovery-submit').textContent = request ? 'Send reset email' : reset ? 'Save new password' : 'Verify email';
    hidePasswords();
  },
  error(message) { $('recovery-error').textContent = message; },
  busy(value) {
    $('recovery-submit').disabled = value;
    $('recovery-form').setAttribute('aria-busy', String(value));
  },
  clear() { $('recovery-form').reset(); clearPasswords(); },
  success(mode) {
    $('recovery-form').hidden = true;
    $('recovery-google').hidden = mode !== 'request';
    $('recovery-new').hidden = false;
    $('recovery-success-icon').hidden = false;
    $('recovery-title').textContent = mode === 'request' ? 'Check your email.' : mode === 'reset' ? 'Password updated.' : 'Email verified.';
    $('recovery-description').textContent = mode === 'request'
      ? 'If this address can be recovered with a password, we’ve sent reset instructions. Check your inbox and spam folder. For your privacy, Taxi Ai shows the same message whether or not an account exists.'
      : mode === 'reset'
        ? 'Your existing web and mobile sessions have ended. Sign in again with your new password.'
        : 'Your email address is confirmed. Return to your account to continue.';
    $('recovery-status').textContent = mode === 'request' ? 'Reset request received.' : 'You’re all set.';
    $('recovery-title').focus();
  },
};

const controller = createAccountRecovery({ client: createApiClient(), view, initial: consumeEmailAction(location, history) });

$('recovery-password-toggle').addEventListener('click', () =>
  setPasswordVisible('recovery-password', 'recovery-password-toggle', $('recovery-password').type === 'password'));
$('recovery-confirm-toggle').addEventListener('click', () =>
  setPasswordVisible('recovery-confirm', 'recovery-confirm-toggle', $('recovery-confirm').type === 'password'));

$('recovery-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const password = $('recovery-password').value, confirmation = $('recovery-confirm').value;
  clearPasswords();
  void controller.submit({ email: $('recovery-email').value, password, confirmation });
});
document.addEventListener('visibilitychange', () => { if (document.hidden) clearPasswords(); });
window.addEventListener('pagehide', () => { clearPasswords(); controller.clear(); });
void controller.load();
