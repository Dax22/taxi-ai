import { $, element } from './dom.mjs';
import { safetyTime, safetyLocation } from './safety-format.mjs';
import { SAFETY_KINDS, INCIDENT_LABELS, ALERT_LABELS } from '/shared/safety.mjs';
import { vehicleMismatchReport } from '/shared/pickup-identity.mjs';

export function createSafetyView({ onAdd, onRemove, onRaise, onShare, onRevoke, onCopy, onOpen, onPage, onReview, onSimulate }) {
  let state = {}, contactsKey = '', incidentsKey = '', queueKey = '', detailKey = '', reviewKey = '';
  const selectedContacts = new Set();
  function button(label, action, disabled = false) {
    const node = element('button', label, 'button button-outline button-small'); node.type = 'button'; node.disabled = disabled;
    node.addEventListener('click', () => { if (!node.disabled) action(); }); return node;
  }
  function incidentCard(record, admin) {
    const card = element('article', undefined, 'safety-record');
    card.append(element('h3', SAFETY_KINDS[record.kind]), element('p', INCIDENT_LABELS[record.status], 'status-badge'),
      element('p', `Incident ${record.id} · ${safetyTime(record.createdAt)} (Abuja)`, 'small-note'));
    const snapshot = record.snapshot, details = element('dl', undefined, 'safety-details');
    for (const [label, value] of [['Trip reference', record.rideId], ['Route', `${snapshot.pickup} → ${snapshot.destination}`],
      ['Driver', `${snapshot.driver.name} · ${snapshot.driver.id}`], ['Vehicle / plate', `${snapshot.driver.vehicle.model} · ${snapshot.driver.vehicle.plate}`],
      ['Vehicle colour', snapshot.driver.vehicle.colour || 'Not recorded'], ['Vehicle category', snapshot.driver.vehicle.category || 'standard'],
      ['Location at report', safetyLocation(snapshot.location)], ['Reporter', `${snapshot.reporter.name} · ${snapshot.reporter.role}`],
      ['Report note', record.note || 'No note provided.']]) details.append(element('dt', label), element('dd', value));
    card.append(details, element('h4', 'Recorded actions'));
    const events = element('ol', undefined, 'safety-events');
    for (const item of record.events) events.append(element('li', `${item.action === 'created' ? 'Test SOS saved' : INCIDENT_LABELS[item.action]} · ${safetyTime(item.createdAt)} (Abuja) · ${item.actorId}${item.note ? ` · ${item.note}` : ''}`));
    card.append(events, element('h4', 'Contact notifications · simulation only'));
    if (!record.notifications.length) card.append(element('p', 'No contacts were selected for this report.', 'small-note'));
    for (const notice of record.notifications) {
      const row = element('div', undefined, 'safety-notification');
      row.append(element('strong', `${notice.recipientName} · ${notice.recipientPhone}`),
        element('p', `${ALERT_LABELS[notice.status]} · attempt ${notice.attempts} of 3`, 'small-note'));
      const history = element('details'), list = element('ol', undefined, 'safety-events');
      history.append(element('summary', 'Test delivery history'));
      for (const event of notice.events) list.append(element('li', `${ALERT_LABELS[event.status]} · attempt ${event.attempt} · ${safetyTime(event.createdAt)} (Abuja)`));
      history.append(list); row.append(history);
      if (admin && state.settings?.canSimulate) {
        const actions = element('div', undefined, 'review-actions');
        const outcomes = notice.status === 'queued' && record.status !== 'resolved' ? [['sent', 'Simulate sending'], ['failed', 'Simulate failure']]
          : notice.status === 'sent' ? [['delivered', 'Simulate delivery'], ['failed', 'Simulate failure']]
            : notice.status === 'failed' && notice.attempts < 3 && record.status !== 'resolved' ? [['retry', 'Queue test retry']] : [];
        for (const [outcome, label] of outcomes) actions.append(button(label, () => onSimulate(notice, outcome), state.pending));
        row.append(actions);
      }
      card.append(row);
    }
    return card;
  }
  function render(next) {
    state = next;
    const member = ['customer', 'driver'].includes(state.user?.role), admin = state.user?.role === 'admin';
    $('trusted-contacts-panel').hidden = !member; $('safety-panel').hidden = !member || !state.ride;
    $('safety-admin-panel').hidden = !admin;
    for (const prefix of ['contacts', 'safety', 'safety-admin']) {
      $(prefix + '-error').textContent = state.error ?? ''; $(prefix + '-notice').textContent = state.message ?? '';
    }
    $('contact-fields').disabled = !member || state.pending || !state.contacts || state.contacts.length >= 3;
    const savedKey = JSON.stringify([state.contacts, state.pending]);
    if (savedKey !== contactsKey) {
      contactsKey = savedKey; $('contacts-list').replaceChildren(); $('safety-recipients').replaceChildren();
      const activeIds = new Set((state.contacts ?? []).map((contact) => contact.id));
      for (const id of selectedContacts) if (!activeIds.has(id)) selectedContacts.delete(id);
      if (!state.contacts?.length) $('contacts-list').append(element('p', state.contacts ? 'No trusted contacts saved yet.' : 'Loading contacts…', 'small-note'));
      for (const contact of state.contacts ?? []) {
        const row = element('li', undefined, 'safety-contact');
        const text = element('div'); text.append(element('strong', contact.name), element('p', `${contact.phone} · unverified`, 'small-note'));
        row.append(text, button('Remove', () => onRemove(contact), state.pending)); $('contacts-list').append(row);
        const label = element('label', undefined, 'safety-check'), input = element('input');
        input.type = 'checkbox'; input.value = contact.id; input.checked = selectedContacts.has(contact.id); input.disabled = state.pending;
        input.addEventListener('change', () => input.checked ? selectedContacts.add(contact.id) : selectedContacts.delete(contact.id));
        label.append(input, element('span', `${contact.name} · ${contact.phone}`)); $('safety-recipients').append(label);
      }
      if (!state.contacts?.length) $('safety-recipients').append(element('p', 'You can save a test SOS without a trusted contact.', 'small-note'));
    }
    const open = state.trip?.incidents.some((record) => record.status !== 'resolved');
    $('safety-fields').disabled = !member || !state.trip?.canRaise || state.pending || Boolean(open);
    $('safety-guidance').textContent = !state.trip ? 'Loading trip safety…' : open
      ? 'Your open test incident is below. It stays open until an administrator records its closure.'
      : state.trip.canRaise ? 'Create a private test report. Only you and authorised administrators can read it.' : 'Test SOS and new share links are available from booking confirmation until the trip ends. Saved reports remain below.';
    const recordsKey = JSON.stringify(state.trip?.incidents);
    if (recordsKey !== incidentsKey) {
      incidentsKey = recordsKey; $('safety-incidents').replaceChildren();
      for (const record of state.trip?.incidents ?? []) $('safety-incidents').append(incidentCard(record, false));
    }
    const share = state.trip?.share;
    $('safety-share-status').textContent = share?.active ? `Link active until ${safetyTime(share.expiresAt)} (Abuja).`
      : 'No active trip link.';
    $('safety-share-create').textContent = share?.active ? 'Replace private link' : 'Create private link';
    $('safety-share-create').disabled = !state.trip?.canRaise || state.pending;
    $('safety-share-minutes').disabled = !state.trip?.canRaise || state.pending;
    $('safety-share-revoke').disabled = !share?.active || state.pending;
    $('safety-share-revoke').onclick = () => { if (share?.active && !state.pending) onRevoke(share); };
    $('safety-share-copy').disabled = !state.shareUrl || state.pending;
    $('safety-share-url').value = state.shareUrl || ''; $('safety-share-url-row').hidden = !state.shareUrl;
    $('safety-share-recover').hidden = !share?.active || Boolean(state.shareUrl);
    $('safety-admin-filter').value = state.filter ?? 'open'; $('safety-admin-filter').disabled = state.pending;
    const listKey = JSON.stringify([state.queue?.incidents, state.pending]);
    if (listKey !== queueKey) {
      queueKey = listKey; $('safety-admin-list').replaceChildren();
      if (!state.queue?.incidents.length) $('safety-admin-list').append(element('p', state.queue ? 'No incidents on this page.' : 'Loading incidents…', 'small-note'));
      for (const record of state.queue?.incidents ?? []) {
        const row = element('article', undefined, 'safety-contact'), text = element('div');
        text.append(element('strong', `${SAFETY_KINDS[record.kind]} · ${record.reporter.name}`),
          element('p', `${INCIDENT_LABELS[record.status]} · ${safetyTime(record.createdAt)} (Abuja)`, 'small-note'));
        row.append(text, button('Open incident', () => onOpen(record.id), state.pending)); $('safety-admin-list').append(row);
      }
    }
    $('safety-admin-latest').disabled = !state.before || state.pending;
    $('safety-admin-older').disabled = !state.queue?.nextBefore || state.pending;
    const currentDetail = JSON.stringify([state.incident, state.pending, state.settings?.canSimulate]);
    if (currentDetail !== detailKey) {
      detailKey = currentDetail; $('safety-admin-detail').replaceChildren();
      if (state.incident) $('safety-admin-detail').append(incidentCard(state.incident, true));
    }
    const record = state.incident, nextReview = record ? `${record.id}:${record.version}` : '';
    if (reviewKey !== nextReview) { reviewKey = nextReview; $('safety-review-note').value = ''; }
    $('safety-review-form').hidden = !record || record.status === 'resolved';
    $('safety-review-fields').disabled = !record || state.pending;
    $('safety-review-submit').textContent = record?.status === 'open' ? 'Acknowledge test incident' : 'Close test incident';
    $('safety-review-form').onsubmit = (event) => {
      event.preventDefault(); if (record && !state.pending && record.status !== 'resolved') onReview(record, record.status === 'open' ? 'acknowledge' : 'resolve', $('safety-review-note').value);
    };
  }
  function clearReview() { reviewKey = ''; $('safety-review-note').value = ''; }
  function saved(action) {
    if (action === 'contact') { $('contact-name').value = ''; $('contact-phone').value = ''; }
    if (action === 'incident') { $('safety-note').value = ''; selectedContacts.clear(); contactsKey = ''; }
    if (action === 'review') clearReview();
  }
  $('contact-form').addEventListener('submit', (event) => { event.preventDefault(); if (!$('contact-fields').disabled) onAdd({ name: $('contact-name').value, phone: $('contact-phone').value }); });
  $('safety-form').addEventListener('submit', (event) => {
    event.preventDefault(); if ($('safety-fields').disabled) return;
    try {
      const data = $('safety-kind').value === 'vehicle_mismatch' ? vehicleMismatchReport($('safety-note').value)
        : { kind: $('safety-kind').value, note: $('safety-note').value };
      onRaise({ ...data, contactIds: [...selectedContacts] });
    } catch (error) { $('safety-error').textContent = error.message; }
  });
  function concern() {
    const mismatch = $('safety-kind').value === 'vehicle_mismatch';
    $('safety-note').maxLength = mismatch ? 480 : 500;
    $('safety-raise').textContent = mismatch ? 'Report different vehicle' : 'Create test SOS';
  }
  $('safety-kind').addEventListener('change', concern);
  $('safety-share-create').addEventListener('click', () => { if (!$('safety-share-create').disabled) onShare(Number($('safety-share-minutes').value)); });
  $('safety-share-copy').addEventListener('click', onCopy);
  $('safety-admin-filter').addEventListener('change', () => onPage(null, $('safety-admin-filter').value));
  $('safety-admin-latest').addEventListener('click', () => onPage(null));
  $('safety-admin-older').addEventListener('click', () => { if (state.queue?.nextBefore) onPage(state.queue.nextBefore); });
  return Object.freeze({ render, saved, clearReview, focusReview() { $('safety-admin-detail').scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    vehicleMismatch(rideId) {
      if (state.ride?.id !== rideId || state.user?.role !== 'customer' || state.pending) return;
      $('safety-kind').value = 'vehicle_mismatch'; concern();
      $('safety-panel').scrollIntoView({ behavior: 'smooth', block: 'start' }); $('safety-note').focus();
    },
    reset() {
      state = {}; contactsKey = incidentsKey = queueKey = detailKey = ''; selectedContacts.clear(); clearReview();
      for (const id of ['contact-name', 'contact-phone', 'safety-note', 'safety-share-url']) $(id).value = '';
      $('safety-kind').value = 'need_help'; concern(); $('safety-share-minutes').value = '15';
      for (const id of ['contacts-list', 'safety-recipients', 'safety-incidents', 'safety-admin-list', 'safety-admin-detail']) $(id).replaceChildren();
    },
  });
}
