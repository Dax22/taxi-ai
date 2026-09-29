import { $, el, date } from './ui.mjs';
import { renderPage } from './pages.mjs';
import { canAccess } from './navigation.mjs';
import { actionForm } from './forms.mjs';

const permissions = { overview: 'analytics.read', analytics: 'analytics.read', accounts: 'accounts.read', trips: 'trips.read', operations: 'operations.read', announcements: 'announcements.manage', cases: 'cases', staff: 'staff.manage', audit: 'audit.read', finance: 'finance.read', compliance: 'compliance.read', demand: 'demand.read', coverage: 'demand.read' };
export function createAdminView() {
  return Object.freeze({
    clear() {
      $('page-content').replaceChildren(); $('staff-name').textContent = ''; $('page-error').textContent = ''; $('updated').textContent = '';
      $('workspace').hidden = true; $('password').value = ''; $('mfa-card').hidden = true; $('mfa-content').replaceChildren(); $('mfa-error').textContent = '';
      for (const anchor of document.querySelectorAll('#navigation a')) anchor.hidden = true;
      $('action-feedback').hidden = true; $('action-message').textContent = '';
    },
    loading(value) { $('loading').hidden = !value; $('refresh').disabled = value; $('login-submit').disabled = value;
      if (value) { $('sign-in').hidden = true; $('mfa-card').hidden = true; } },
    signIn(message) { $('sign-in').hidden = false; $('workspace').hidden = true; $('mfa-card').hidden = true; $('loading').hidden = true; $('auth-error').textContent = message; },
    error(message) { $('workspace').hidden = false; $('sign-in').hidden = true; $('page-content').replaceChildren(); $('page-error').textContent = message; },
    actionError(message) { $('workspace').hidden = false; $('sign-in').hidden = true; $('page-content').replaceChildren(); $('action-feedback').hidden = false; $('action-message').textContent = message; },
    mfa(state, setup = null, error = '') {
      $('mfa-card').hidden = false; $('workspace').hidden = true; $('sign-in').hidden = true; $('loading').hidden = true; $('mfa-error').textContent = error;
      const content = $('mfa-content'); content.replaceChildren();
      if (!state.available) { $('mfa-description').textContent = state.required ? 'Authenticator verification is required, but it is unavailable on this server. Ask the workspace owner to check the authentication configuration.' : 'Authenticator setup is unavailable on this server. Ask the workspace owner to configure it before enabling this protection.'; return; }
      if (setup || state.enrolled) {
        $('mfa-description').textContent = setup ? 'Add Taxi Ai to your authenticator app, then enter its current six-digit code.' : 'Enter the current six-digit code from your authenticator app.';
        if (setup?.secret) {
          const details = el('div', null, 'mfa-setup'); details.append(el('p', 'Manual setup key · keep private'), el('code', setup.secret, 'mfa-secret'), el('p', `Setup expires ${date(setup.expiresAt)}. This key is cleared when you leave this page.`, 'small muted')); content.append(details);
        }
        const form = actionForm({ title: 'Verify authenticator', action: '/mfa/' + (setup ? 'confirm' : 'verify'), submit: 'Verify and continue', fields: [
          { name: 'code', label: 'Six-digit code', min: 6, max: 6, autocomplete: 'one-time-code' },
        ] });
        const code = form.querySelector?.('input[name="code"]'); code?.setAttribute('inputmode', 'numeric'); code?.setAttribute('pattern', '[0-9]{6}'); content.append(form);
      } else {
        $('mfa-description').textContent = 'Set up an authenticator app to protect your staff account. Confirm your password to begin.';
        content.append(actionForm({ title: 'Set up authenticator', action: '/mfa/enroll', submit: 'Create setup key', fields: [{ name: 'password', label: 'Current account password', type: 'password', max: 128, autocomplete: 'current-password' }] }));
      }
    },
    render(route, data, user, staff) {
      const page = renderPage(route, data, staff);
      $('page-content').replaceChildren(page); $('page-title').textContent = route.title; $('breadcrumb').textContent = route.title;
      $('page-description').textContent = route.description; $('staff-name').textContent = `${user.name}${staff ? ' · ' + staff.role : ''}`;
      $('updated').textContent = `Updated ${date(data.serverNow ?? data.asOf)}`;
      for (const anchor of document.querySelectorAll('#navigation a')) {
        anchor.hidden = staff ? !canAccess(staff, permissions[anchor.dataset.section]) : true;
        if (anchor.dataset.section === 'overview' && staff?.role === 'finance' && canAccess(staff, 'finance.read')) anchor.hidden = true;
        if (anchor.dataset.section === route.section) anchor.setAttribute('aria-current', 'page'); else anchor.removeAttribute('aria-current');
      }
      $('legacy-review').hidden = !staff?.permissions?.includes('legacy.review');
      for (const anchor of page.querySelectorAll?.('a[href^="/admin"]') ?? []) {
        const section = anchor.getAttribute('href').split(/[/?]/)[2] || 'overview';
        if (!canAccess(staff, permissions[section])) anchor.replaceWith(document.createTextNode(anchor.textContent));
      }
      document.title = `${route.title} · Taxi Ai Operations`; $('workspace').hidden = false; $('sign-in').hidden = true; $('mfa-card').hidden = true; $('auth-error').textContent = '';
    },
  });
}
