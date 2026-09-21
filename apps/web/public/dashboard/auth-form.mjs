import { $ } from './dom.mjs';

export function bindAuthForm({ onSubmit }) {
  let registration = false;
  function setAuthMode(create) {
    registration = create;
    $('show-login').setAttribute('aria-pressed', String(!create));
    $('show-register').setAttribute('aria-pressed', String(create));
    $('registration-fields').hidden = !create;
    $('account-name').disabled = !create;
    $('account-name').required = create;
    $('account-password').autocomplete = create ? 'new-password' : 'current-password';
    $('forgot-password').hidden = create;
    $('auth-title').textContent = create ? 'Make your next move.' : 'Welcome back.';
    $('auth-description').textContent = create ? 'Your account, your way to move.' : 'Sign in to pick up where you left off.';
    $('auth-submit').textContent = create ? 'Create account ↗' : 'Sign in ↗';
    $('page-error').textContent = '';
  }

  $('show-login').addEventListener('click', () => setAuthMode(false));
  $('show-register').addEventListener('click', () => setAuthMode(true));
  $('auth-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const data = { email: $('account-email').value, password: $('account-password').value };
    if (registration) {
      data.name = $('account-name').value;
    }
    onSubmit(registration ? '/api/auth/register' : '/api/auth/login', data);
  });
  setAuthMode(false);
  return Object.freeze({ reset() { $('auth-form').reset(); setAuthMode(false); } });
}
