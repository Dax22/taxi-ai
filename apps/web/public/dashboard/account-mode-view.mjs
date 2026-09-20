import { $, element } from './dom.mjs';
import { RIDE_STATUS_LABELS } from '/shared/trip-lifecycle.mjs';

/** Controls are local to this window; selecting a mode grants no permissions. */
export function createAccountModeView({ onSwitch, onCancel, onAddDriver, onOpenRide }) {
  let state = null, busy = false, activeKey = '';
  function render(next, working = false) {
    state = next; busy = working;
    const account = state.account, personal = account && account.role !== 'admin';
    $('account-modes').hidden = !personal;
    if (!personal) return;
    const work = account.capabilities.includes('driver');
    $('mode-customer').setAttribute('aria-pressed', String(state.mode === 'customer'));
    $('mode-work').setAttribute('aria-pressed', String(state.mode === 'work'));
    $('mode-work').textContent = work ? 'Work' : 'Apply to drive';
    $('mode-note').textContent = state.mode === 'work'
      ? 'Your driver application, availability and earnings. Approval and current documents are required to accept rides.'
      : 'Your personal rides, payments and trip history. Use this same account to apply to drive.';
    $('mode-confirm').hidden = !state.modePrompt;
    $('driver-enrollment').hidden ||= work;
    $('driver-enrollment-fields').disabled = busy || work;
    for (const id of ['mode-customer', 'mode-work', 'mode-offline-confirm', 'mode-cancel', 'driver-enrollment-cancel']) $(id).disabled = busy;
    const key = JSON.stringify(state.activeElsewhere);
    if (key !== activeKey) {
      activeKey = key; $('mode-active-list').replaceChildren();
      for (const ride of state.activeElsewhere) {
        const row = element('li'), button = element('button',
          `Open ${ride.mode === 'work' ? 'Work' : 'Customer'} journey · ${RIDE_STATUS_LABELS[ride.status] ?? ride.status} · ${ride.id.slice(0, 8).toUpperCase()}`,
          'button button-outline button-small');
        button.type = 'button'; button.addEventListener('click', () => { if (!busy) onOpenRide(ride.id); });
        row.append(button); $('mode-active-list').append(row);
      }
    }
    $('mode-active').hidden = !state.activeElsewhere.length;
  }
  $('mode-customer').addEventListener('click', () => onSwitch('customer'));
  $('mode-work').addEventListener('click', () => {
    if (state?.account?.capabilities.includes('driver')) return onSwitch('work');
    $('driver-enrollment').hidden = false; $('driver-profile-model').focus();
  });
  $('mode-offline-confirm').addEventListener('click', () => onSwitch('customer', true));
  $('mode-cancel').addEventListener('click', onCancel);
  $('driver-enrollment-cancel').addEventListener('click', () => { $('driver-enrollment').hidden = true; $('driver-enrollment').reset(); });
  $('driver-enrollment').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!busy) onAddDriver({ model: $('driver-profile-model').value, plate: $('driver-profile-plate').value });
  });
  return Object.freeze({ render, focus() { $('dashboard-title').focus(); }, reset() {
    state = null; activeKey = ''; $('account-modes').hidden = true; $('driver-enrollment').hidden = true;
    $('driver-enrollment').reset(); $('mode-active-list').replaceChildren();
  } });
}

export function modePreferences(storage) {
  const key = (id) => `taxi-ai:mode:${id}`;
  return Object.freeze({
    get(id) { try { return storage.getItem(key(id)); } catch { return null; } },
    set(id, mode) { try { storage.setItem(key(id), mode); } catch { /* In-memory mode still works. */ } },
    clear(id) { try { storage.removeItem(key(id)); } catch { /* Storage may be disabled. */ } },
  });
}
