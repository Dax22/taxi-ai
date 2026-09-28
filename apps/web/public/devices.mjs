import { createApiClient } from './dashboard/api-client.mjs';
const api = createApiClient(), list = document.getElementById('device-list'), status = document.getElementById('device-status');
const error = document.getElementById('device-error'), refresh = document.getElementById('device-refresh');
let busy = false;
async function load() {
  if (busy) return;
  busy = true; refresh.disabled = true; api.reset(); list.replaceChildren(); error.textContent = ''; status.textContent = 'Loading your account…';
  try {
    const session = await api.request('/api/session');
    if (!session.user || session.user.role === 'admin') { status.textContent = 'Sign in with your personal website account to manage mobile devices.'; return; }
    api.setCsrf(session.csrfToken);
    const result = await api.request('/api/account/devices');
    status.textContent = `${session.user.name} · ${result.devices.length} signed-in mobile devices`;
    for (const device of result.devices) {
      const card = document.createElement('article'); card.className = 'account-card';
      const heading = document.createElement('h2'); heading.textContent = device.name;
      const detail = document.createElement('p'); detail.textContent = `Signed in ${new Date(device.createdAt).toLocaleString()}. Last session renewal ${new Date(device.refreshedAt).toLocaleString()}.`;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'button button-outline button-small'; button.textContent = 'Sign out this device';
      button.addEventListener('click', async () => {
        if (busy || !window.confirm(`Sign out “${device.name}”?`)) return;
        busy = true; button.disabled = true; refresh.disabled = true; error.textContent = '';
        try { await api.command(`/api/account/devices/${device.id}/revoke`, {}); }
        catch (e) { error.textContent = e.message; }
        finally { busy = false; refresh.disabled = false; button.disabled = false; }
        if (!error.textContent) await load();
      });
      card.append(heading, detail, button); list.append(card);
    }
  } catch (e) { status.textContent = 'Could not load devices.'; error.textContent = e.message; }
  finally { busy = false; refresh.disabled = false; }
}
refresh.addEventListener('click', load);
document.addEventListener('visibilitychange', () => { if (document.hidden) { api.reset(); list.replaceChildren(); status.textContent = ''; } else void load(); });
void load();
