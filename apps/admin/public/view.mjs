import { $, date } from './ui.mjs';
import { renderPage } from './pages.mjs';

export function createAdminView() {
  return Object.freeze({
    clear() { $('page-content').replaceChildren(); $('staff-name').textContent = ''; $('page-error').textContent = ''; $('updated').textContent = '';
      $('workspace').hidden = true; $('password').value = ''; },
    loading(value) { $('loading').hidden = !value; $('refresh').disabled = value; $('login-submit').disabled = value;
      if (value) $('sign-in').hidden = true; },
    signIn(message) { $('sign-in').hidden = false; $('workspace').hidden = true; $('loading').hidden = true; $('auth-error').textContent = message; },
    error(message) { $('workspace').hidden = false; $('sign-in').hidden = true; $('page-content').replaceChildren(); $('page-error').textContent = message; },
    render(route, data, user) {
      const page = renderPage(route, data);
      $('page-content').replaceChildren(page); $('page-title').textContent = route.title; $('breadcrumb').textContent = route.title;
      $('page-description').textContent = route.description; $('staff-name').textContent = user.name;
      $('updated').textContent = `Updated ${date(data.serverNow)}`;
      for (const anchor of document.querySelectorAll('#navigation a')) {
        if (anchor.dataset.section === route.section) anchor.setAttribute('aria-current', 'page'); else anchor.removeAttribute('aria-current');
      }
      document.title = `${route.title} · Taxi Ai Operations`; $('workspace').hidden = false; $('sign-in').hidden = true; $('auth-error').textContent = '';
    },
  });
}
