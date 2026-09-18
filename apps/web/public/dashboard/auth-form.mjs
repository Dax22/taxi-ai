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
    $('account-role').disabled = !create;
    $('account-password').autocomplete = create ? 'new-password' : 'current-password';
    $('auth-title').textContent = create ? 'Make your next move.' : 'Welcome back.';
    $('auth-description').textContent = create ? 'Your account, your way to move.' : 'Sign in to pick up where you left off.';
    $('auth-submit').textContent = create ? 'Create account ↗' : 'Sign in ↗';
    const driver = create && $('account-role').value === 'driver';
    $('vehicle-fields').hidden = !driver;
    $('vehicle-fields').disabled = !driver;
    $('vehicle-model').required = driver;
    $('vehicle-plate').required = driver;
    $('page-error').textContent = '';
  }

  $('show-login').addEventListener('click', () => setAuthMode(false));
  $('show-register').addEventListener('click', () => setAuthMode(true));
  $('account-role').addEventListener('change', () => setAuthMode(registration));
  $('auth-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const data = { email: $('account-email').value, password: $('account-password').value };
    if (registration) {
      Object.assign(data, { name: $('account-name').value, role: $('account-role').value });
      if (data.role === 'driver') data.vehicle = { model: $('vehicle-model').value, plate: $('vehicle-plate').value };
    }
    onSubmit(registration ? '/api/auth/register' : '/api/auth/login', data);
  });
  setAuthMode(false);
  return Object.freeze({ reset() { $('auth-form').reset(); setAuthMode(false); } });
}
