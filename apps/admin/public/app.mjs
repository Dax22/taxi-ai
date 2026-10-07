import { $ } from './ui.mjs';
import { routeFor } from './navigation.mjs';
import { createAdminClient } from './api-client.mjs';
import { createAdminView } from './view.mjs';
import { createAdminController } from './controller.mjs';
import { formPayload } from './forms.mjs';

const route = routeFor(window.location), view = createAdminView();
const controller = createAdminController({ client: createAdminClient(), view, route });
$('login-form').addEventListener('submit', (event) => { event.preventDefault(); void controller.login({ email: $('email').value, password: $('password').value }); });
$('refresh').addEventListener('click', () => { void controller.load(); });
$('logout').addEventListener('click', () => { void controller.logout(); });
$('security').addEventListener('click', () => { void controller.security(); });
$('mfa-logout').addEventListener('click', () => { void controller.logout(); });
$('retry-action').addEventListener('click', () => { void controller.retry(); });
document.addEventListener('submit', (event) => {
  const form = event.target;
  if (!form.dataset.action) return;
  event.preventDefault();
  const data = formPayload(form), path = form.dataset.action;
  if (path.startsWith('/mfa/')) void controller.mfa(path.slice('/mfa/'.length), data);
  else void controller.mutate(path, data);
});
document.addEventListener('change', (event) => {
  if (route.name !== 'operations' || event.target.name !== 'queue') return;
  const status = event.target.form?.querySelector('[name="status"]');
  if (status) { status.value = 'all'; status.disabled = true; }
});
let timer = null;
function schedule() {
  clearTimeout(timer);
  if (document.hidden) return;
  timer = setTimeout(async () => {
    if (document.hidden) return;
    if ($('workspace').hidden) { schedule(); return; }
    if (['operations', 'matching', 'mobile', 'acceptance', 'safetyAlerts', 'safetyAlertDetail'].includes(route.name) && !document.activeElement?.closest('#page-content form')) await controller.load(); else await controller.revalidate();
    schedule();
  }, route.section === 'safety-alerts' ? 10000 : 30000);
}
document.addEventListener('visibilitychange', () => {
  clearTimeout(timer);
  if (document.hidden) controller.conceal(); else { void controller.load(); schedule(); }
});
window.addEventListener('pagehide', () => { clearTimeout(timer); controller.conceal(); });
window.addEventListener('pageshow', (event) => { if (event.persisted) { void controller.load(); schedule(); } });
// Expire a current-location view even while a reviewer is typing.
if (route.section === 'safety-alerts') setInterval(() => {
  for (const node of document.querySelectorAll('[data-safety-current="true"]')) {
    if (Date.now() - Number(node.getAttribute('data-received-at')) >= 30000) {
      node.replaceChildren(document.createTextNode('Current-location view expired. Refresh to verify sharing access. Incident evidence is historical.'));
      node.removeAttribute('data-safety-current');
    }
  }
}, 1000);
void controller.load(); schedule();
