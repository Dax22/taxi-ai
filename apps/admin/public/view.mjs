import { $, el, date } from './ui.mjs';
import { renderPage } from './pages.mjs';
import { commandSections } from './command-center-navigation.mjs';
import { canAccess } from './navigation.mjs';
import { actionForm } from './forms.mjs';

const permissions = { overview: 'analytics.read', analytics: 'analytics.read', accounts: 'accounts.read', trips: 'trips.read', operations: 'operations.read', announcements: 'announcements.manage', cases: 'cases', staff: 'staff.manage', audit: 'audit.read', finance: 'finance.read', compliance: 'compliance.read', demand: 'demand.read', coverage: 'demand.read' };
Object.assign(permissions,Object.fromEntries(Object.entries(commandSections).map(([key,value])=>[key,value[2]])));
export function createAdminView() {
  return Object.freeze({
    clear() {
      $('page-content').replaceChildren(); $('staff-name').textContent = ''; $('page-error').textContent = ''; $('updated').textContent = '';
      $('workspace').hidden = true; $('password').value = ''; $('mfa-card').hidden = true; $('mfa-content').replaceChildren(); $('mfa-error').textContent = '';
      for (const anchor of document.querySelectorAll('#navigation a')) anchor.hidden = true;
      $('action-feedback').hidden = true; $('action-message').textContent = ''; $('retry-action').hidden=false;
    },
    loading(value) { $('loading').hidden = !value; $('refresh').disabled = value; $('login-submit').disabled = value;
      document.body.setAttribute('aria-busy', value ? 'true' : 'false');
      if (value) { $('sign-in').hidden = true; $('mfa-card').hidden = true; } },
    signIn(message) { $('sign-in').hidden = false; $('workspace').hidden = true; $('mfa-card').hidden = true; $('loading').hidden = true; $('auth-error').textContent = message; },
    error(message) { $('workspace').hidden = false; $('sign-in').hidden = true; $('page-content').replaceChildren(); $('page-error').textContent = message; },
    actionError(message) { $('workspace').hidden = false; $('sign-in').hidden = true; $('page-content').replaceChildren(); $('action-feedback').hidden = false; $('action-message').textContent = message; $('retry-action').hidden=false; },
    deliverEvidence({bytes,filename,sha256,exportId}) {
      const blob=new Blob([bytes],{type:'application/zip'}),url=URL.createObjectURL(blob);
      const anchor=el('a',null,'',{href:url,download:filename});anchor.download=filename;
      document.body.append(anchor);try{anchor.click();}finally{anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
      $('action-feedback').hidden=false;$('action-message').textContent=`Evidence archive prepared. Export ID: ${exportId}. SHA-256: ${sha256}. Save this checksum in the secure case file. Never send the ZIP unencrypted.`;
      $('retry-action').hidden=true;
    },
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
        const target = new URL(anchor.getAttribute('href'), window.location.origin);
        const routeService = route.query?.get?.('service') ?? null;
        const targetService = target.searchParams.get('service');
        const active = !anchor.hidden && target.pathname === route.path
          && (route.section !== 'transactions' || targetService === routeService || !targetService && !routeService);
        if (active) anchor.setAttribute('aria-current', 'page'); else anchor.removeAttribute('aria-current');
      }
      for (const group of document.querySelectorAll('#navigation .nav-group')) {
        const links = [...group.querySelectorAll('a')], visible = links.filter((anchor) => !anchor.hidden);
        group.hidden = visible.length === 0;
        group.open = visible.some((anchor) => anchor.getAttribute('aria-current') === 'page');
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
