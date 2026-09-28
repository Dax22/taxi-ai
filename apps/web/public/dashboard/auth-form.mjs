import { $ } from './dom.mjs';

export function bindAuthForm({ onSubmit }) {
  let registration = false, intent = 'customer';
  const password = $('account-password'), passwordToggle = $('account-password-toggle');
  const intentButtons = [...document.querySelectorAll('[data-registration-intent]')];

  function setPasswordVisible(visible) {
    password.type = visible ? 'text' : 'password';
    passwordToggle.setAttribute('aria-pressed', String(visible));
    passwordToggle.textContent = visible ? 'Hide' : 'Show';
  }

  function setIntent(next) {
    if (!['customer','driver','eats_seller'].includes(next)) return;
    intent = next;
    for (const button of intentButtons) button.setAttribute('aria-pressed', String(button.dataset.registrationIntent === next));
  }

  function setAuthMode(create) {
    registration = create;
    $('show-login').setAttribute('aria-pressed', String(!create));
    $('show-register').setAttribute('aria-pressed', String(create));
    $('registration-fields').hidden = !create;
    $('account-name').disabled = !create;
    $('account-name').required = create;
    password.autocomplete = create ? 'new-password' : 'current-password';
    $('forgot-password').hidden = create;
    $('auth-title').textContent = create ? 'Create one Taxi Ai account.' : 'Welcome back.';
    $('auth-description').textContent = create ? 'Choose how you want to start. You can add other Taxi Ai services later.' : 'Sign in to pick up where you left off.';
    $('auth-submit').textContent = create ? 'Create account ↗' : 'Sign in ↗';
    $('page-error').textContent = '';
    if (create) setIntent('customer');
    setPasswordVisible(false);
  }

  passwordToggle.addEventListener('click', () => setPasswordVisible(password.type === 'password'));
  for (const button of intentButtons) button.addEventListener('click', () => setIntent(button.dataset.registrationIntent));
  $('show-login').addEventListener('click', () => setAuthMode(false));
  $('show-register').addEventListener('click', () => setAuthMode(true));
  $('auth-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const data = { email: $('account-email').value, password: password.value };
    if (registration) { data.name = $('account-name').value; data.intent = intent; }
    onSubmit(registration ? '/api/auth/register' : '/api/auth/login', data);
  });
  setAuthMode(false);
  return Object.freeze({
    reset() { $('auth-form').reset(); setAuthMode(false); },
    registrationIntent() { return registration ? intent : null; },
  });
}
