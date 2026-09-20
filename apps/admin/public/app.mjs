import { $ } from './ui.mjs';
import { routeFor } from './navigation.mjs';
import { createAdminClient } from './api-client.mjs';
import { createAdminView } from './view.mjs';
import { createAdminController } from './controller.mjs';

const route = routeFor(window.location), view = createAdminView();
const controller = createAdminController({ client: createAdminClient(), view, route });
$('login-form').addEventListener('submit', (event) => { event.preventDefault(); void controller.login({ email: $('email').value, password: $('password').value }); });
$('refresh').addEventListener('click', () => { void controller.load(); });
$('logout').addEventListener('click', () => { void controller.logout(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) controller.conceal(); else void controller.load(); });
window.addEventListener('pagehide', () => controller.conceal());
window.addEventListener('pageshow', (event) => { if (event.persisted) void controller.load(); });
void controller.load();
