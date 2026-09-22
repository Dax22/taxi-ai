import { $, element } from './dom.mjs';
import { DRIVER_DOCUMENTS, DRIVER_REVIEW_CHECKS, DRIVER_APPLICATION_LABELS } from '/shared/driver-onboarding.mjs';
import { renderVehicleCard } from './vehicle-card.mjs';
import { createVehicleFields } from './vehicle-fields.mjs';

const detailFields = ['legalName', 'phone', 'licenceNumber', 'make', 'model', 'year', 'colour', 'plate'];
const editable = (app) => ['draft', 'changes_requested', 'rejected'].includes(app?.status);
export function createOnboardingView({ onAction, onDownload, onClose }) {
  let current = null, user = null, formVersion = null, dirty = false, renderedVersion = null, lastState = null;
  let deleteVersion = null;
  const input = (name) => $(`onboarding-${name}`);
  const vehicleFields = createVehicleFields({ onChange() { dirty = true; if (lastState) render(lastState); } });
  for (const [kind, spec] of Object.entries(DRIVER_DOCUMENTS)) {
    const option = element('option', spec.label); option.value = kind; input('kind').append(option);
  }
  for (const [key, text] of Object.entries(DRIVER_REVIEW_CHECKS)) {
    const row = element('label', undefined, 'onboarding-check'), checkbox = element('input');
    checkbox.type = 'checkbox'; checkbox.id = `onboarding-check-${key}`;
    row.append(checkbox, element('span', text)); $('onboarding-checks').append(row);
  }
  function expiry() {
    const required = DRIVER_DOCUMENTS[input('kind').value]?.expires;
    input('expiresOn').required = Boolean(required); input('expiry-row').hidden = !required;
    if (!required) input('expiresOn').value = '';
  }
  input('kind').addEventListener('change', expiry); expiry();
  $('onboarding-details-form').addEventListener('input', () => { dirty = true; if (lastState) render(lastState); });
  $('onboarding-details-form').addEventListener('submit', (event) => {
    event.preventDefault(); if (!current) return;
    const values = { ...Object.fromEntries(detailFields.map((name) => [name, input(name).value])), ...vehicleFields.values() };
    onAction('save', { expectedVersion: formVersion, details: { legalName: values.legalName, phone: values.phone, licenceNumber: values.licenceNumber,
      vehicle: { make: values.make, model: values.model, year: Number(values.year), colour: values.colour, plate: values.plate, category: values.category, payloadKg: values.payloadKg } } });
  });
  $('onboarding-upload-form').addEventListener('submit', (event) => {
    event.preventDefault(); if (!current) return;
    onAction('upload', { expectedVersion: current.version, kind: input('kind').value,
      expiresOn: DRIVER_DOCUMENTS[input('kind').value].expires ? input('expiresOn').value : null }, input('file').files[0]);
  });
  $('onboarding-review-form').addEventListener('submit', (event) => {
    event.preventDefault(); if (!current || !event.submitter) return;
    onAction('review', { expectedVersion: current.version, decision: event.submitter.value,
      reason: input('reason').value, reference: input('reference').value,
      checks: Object.fromEntries(Object.keys(DRIVER_REVIEW_CHECKS).map((key) => [key, input(`check-${key}`).checked])) });
  });
  $('onboarding-reload').addEventListener('click', () => { dirty = false; renderedVersion = null; render({ user, application: current, pending: false, error: '' }); });
  $('onboarding-submit').addEventListener('click', () => onAction('submit', { expectedVersion: current.version }));
  function editVehicle() {
    if (!current || user?.role !== 'driver' || lastState.pending || current.busy) return;
    cancelDelete();
    if (editable(current)) {
      input('details-form').scrollIntoView({ behavior: 'smooth', block: 'start' }); input('make').focus();
    } else { input('edit-confirm').hidden = false; input('reopen').focus(); }
  }
  function cancelDelete() { deleteVersion = null; input('delete-form').hidden = true; input('delete-confirmation').value = ''; }
  input('edit-vehicle').addEventListener('click', editVehicle);
  input('edit-cancel').addEventListener('click', () => { input('edit-confirm').hidden = true; input('edit-vehicle').focus(); });
  $('onboarding-reopen').addEventListener('click', () => {
    if (current && !lastState.pending && !current.busy) onAction('reopen', { expectedVersion: current.version });
  });
  input('delete-profile').addEventListener('click', () => {
    if (!current || user?.role !== 'driver' || lastState.pending || current.busy) return;
    input('edit-confirm').hidden = true; deleteVersion = current.version;
    input('delete-form').hidden = false; input('delete-confirmation').value = ''; input('delete-confirmation').focus();
  });
  input('delete-cancel').addEventListener('click', () => { cancelDelete(); input('delete-profile').focus(); });
  input('delete-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!current || user?.role !== 'driver' || lastState.pending || current.busy || deleteVersion !== current.version || input('delete-confirmation').value !== 'DELETE') return;
    onAction('delete-profile', { expectedVersion: deleteVersion, confirmation: 'DELETE' });
  });
  $('onboarding-close').addEventListener('click', onClose);
  function reset() {
    current = user = lastState = null; formVersion = renderedVersion = null; dirty = false;
    cancelDelete(); input('edit-confirm').hidden = true;
    for (const id of ['details', 'upload', 'review']) $(`onboarding-${id}-form`).reset();
    vehicleFields.load();
    for (const id of ['documents', 'history', 'summary']) $(`onboarding-${id}`).replaceChildren();
    input('title').textContent = 'Your Work profile'; input('eligibility').textContent = ''; input('stale').hidden = true;
    input('status').textContent = ''; input('reason-note').textContent = ''; input('error').textContent = '';
    renderVehicleCard(input('vehicle-preview'), null);
    $('onboarding-panel').hidden = true; expiry();
  }
  function render({ user: account, application: app, pending, error }) {
    lastState = { user: account, application: app, pending, error };
    user = account; current = app;
    $('onboarding-panel').hidden = !user || (!app && user.role !== 'driver');
    input('error').textContent = error;
    input('loading').hidden = Boolean(app); input('content').hidden = !app;
    if (!app) return;
    const owner = user.role === 'driver', canEdit = owner && editable(app) && !app.busy;
    input('owner-controls').hidden = !owner;
    if (deleteVersion !== null && (deleteVersion !== app.version || !owner || app.busy)) cancelDelete();
    for (const name of ['edit-vehicle', 'delete-profile', 'delete-submit', 'delete-confirmation']) input(name).disabled = pending || app.busy;
    for (const name of ['delete-cancel', 'edit-cancel']) input(name).disabled = pending;
    if (!owner || editable(app)) input('edit-confirm').hidden = true;
    input('progress').hidden = !owner;
    const changed = renderedVersion !== app.version;
    if (changed) {
      if (!dirty) {
        const details = app.details ?? {}, vehicle = details.vehicle ?? app.vehicle ?? {};
        for (const name of ['legalName', 'phone', 'licenceNumber', 'plate']) input(name).value = details[name] ?? vehicle[name] ?? '';
        vehicleFields.load(vehicle);
        formVersion = app.version;
      }
      // Checkboxes always belong to the exact version reviewed on screen.
      $('onboarding-review-form').reset(); renderedVersion = app.version;
    }
    input('status').textContent = `${DRIVER_APPLICATION_LABELS[app.status]} · version ${app.version}`;
    input('title').textContent = owner ? 'Your Work profile' : `Review ${app.name}`;
    input('reason-note').textContent = app.reviewReason ? `Last review: ${app.reviewReason}` : '';
    input('eligibility').textContent = app.eligibility.eligible ? 'Manual checks recorded. Current documents allow you to go online.'
      : app.busy ? 'Finish or cancel assigned work before updating this application.'
        : app.eligibility.expired.length ? 'A document has expired. Reopen the application, replace it and submit for a new review.'
          : app.status === 'submitted' ? 'Submitted. An administrator must inspect the documents and record their checks.'
            : 'Complete your details and all five documents, then submit for review.';
    input('stale').hidden = !dirty || formVersion === app.version;
    input('reload').disabled = pending;
    vehicleFields.setDisabled(!canEdit || pending);
    const preview = owner ? { ...vehicleFields.values(), year: undefined, plate: input('plate').value } : app.details?.vehicle;
    if (preview && owner && /^\d{4}$/.test(input('year').value)) preview.year = Number(input('year').value);
    renderVehicleCard(input('vehicle-preview'), preview, { label: owner ? dirty ? 'UNSAVED VEHICLE PREVIEW' : 'YOUR VEHICLE PREVIEW' : 'VEHICLE SUBMITTED FOR REVIEW' });
    input('summary').replaceChildren();
    if (!owner && app.details) {
      for (const [term, value] of [['Legal name', app.details.legalName], ['Contact', app.details.phone], ['Licence', app.details.licenceNumber],
        ['Category / capacity', `${app.details.vehicle.category ?? 'standard'}${app.details.vehicle.payloadKg ? ` · ${app.details.vehicle.payloadKg} kg` : ''}`],
        ['Vehicle', `${app.details.vehicle.year} ${app.details.vehicle.make} ${app.details.vehicle.model} · ${app.details.vehicle.colour} · ${app.details.vehicle.plate}`]]) {
        input('summary').append(element('dt', term), element('dd', value));
      }
    }
    input('details-form').hidden = !owner; input('details-fields').disabled = !canEdit || pending;
    input('upload-form').hidden = !owner; input('upload-fields').disabled = !canEdit || pending || dirty;
    input('submit').hidden = !owner || !editable(app);
    input('submit').disabled = pending || app.busy || dirty || !app.details || app.eligibility.missing.length > 0 || app.eligibility.expired.length > 0;
    input('reopen').hidden = !owner || !['approved', 'submitted'].includes(app.status);
    input('reopen').disabled = pending || app.busy;
    input('close').hidden = owner; input('close').disabled = pending;
    input('review-form').hidden = owner || app.status !== 'submitted'; input('review-fields').disabled = pending || app.busy;
    input('documents').replaceChildren();
    for (const [kind, spec] of Object.entries(DRIVER_DOCUMENTS)) {
      const doc = app.documents.find((item) => item.kind === kind), row = element('li', undefined, 'onboarding-document');
      const content = element('div'); content.append(element('strong', spec.label));
      content.append(element('p', doc ? `${doc.name} · ${Math.ceil(doc.sizeBytes / 1024)} KiB${doc.expiresOn ? ` · expires ${doc.expiresOn} (Abuja)` : ''}` : 'Not uploaded', 'small-note'));
      if (doc && !owner) content.append(element('p', doc.readByReviewer ? 'Downloaded by you · inspect it before recording a check' : 'Download required for review', 'small-note'));
      row.append(content);
      if (doc) {
        const actions = element('div', undefined, 'review-actions'), download = element('button', 'Download', 'button button-outline button-small');
        download.type = 'button'; download.disabled = pending; download.addEventListener('click', () => onDownload(doc.id)); actions.append(download);
        if (canEdit) {
          const remove = element('button', 'Remove', 'button button-outline button-small'); remove.type = 'button'; remove.disabled = pending || dirty;
          remove.addEventListener('click', () => onAction('remove', { expectedVersion: app.version, documentId: doc.id })); actions.append(remove);
        }
        row.append(actions);
      }
      input('documents').append(row);
    }
    input('history').replaceChildren();
    for (const entry of app.events) {
      const item = element('li', `${new Date(entry.createdAt).toLocaleString()} · ${DRIVER_APPLICATION_LABELS[entry.action] ?? entry.action} · v${entry.version}`);
      if (entry.payload.reason) item.append(element('p', entry.payload.reason));
      if (entry.payload.verification) item.append(element('p', `Manual review reference: ${entry.payload.verification.reference} · reviewer ${entry.actorId}`));
      input('history').append(item);
    }
  }
  return Object.freeze({ render, reset, editVehicle, acceptChanges() { dirty = false; renderedVersion = null; input('file').value = ''; },
    focus() { $('onboarding-panel').scrollIntoView({ behavior: 'smooth', block: 'start' }); } });
}
