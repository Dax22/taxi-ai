import { $ } from './dom.mjs';
import { DRIVER_FACE_CONSENT, driverFacePresentation } from '/shared/driver-face-check.mjs';

/** Only explicit applicant consent starts a paid comparison; rendering never does. */
export function createDriverFaceView({ onAction, clock = Date.now }) {
  const input = (name) => $(`onboarding-face-${name}`);
  let state = null, snapshot = null;
  input('consent-text').textContent = DRIVER_FACE_CONSENT;
  function allowed() {
    const { app, owner, pending, dirty } = state ?? {};
    const check = app?.faceCheck;
    return owner && check?.available && ['draft', 'changes_requested', 'rejected'].includes(app.status)
      && !pending && !dirty && !app.busy && check.status !== 'pending' && check.status !== 'matched'
      && !(check.retryAfter > clock()) && ['profile_photo', 'driving_licence'].every((kind) => app.documents.some((doc) => doc.kind === kind));
  }
  input('consent').addEventListener('change', () => { input('run').disabled = !allowed() || !input('consent').checked; });
  input('run').addEventListener('click', () => {
    if (!allowed() || !input('consent').checked) return;
    return onAction('face-check', { expectedVersion: state.app.version, consent: true });
  });
  function reset() {
    state = snapshot = null; input('consent').checked = false; input('panel').hidden = true;
    for (const name of ['status', 'detail', 'evidence', 'guidance']) input(name).textContent = '';
  }
  function render(value) {
    state = value;
    const { app, owner, pending, dirty } = value;
    if (!app) { reset(); return; }
    const check = app.faceCheck, next = `${app.driverId}:${app.version}:${owner}:${check?.status}`;
    if (snapshot !== next) { input('consent').checked = false; snapshot = next; }
    input('panel').hidden = false;
    const presentation = driverFacePresentation(check);
    input('status').textContent = presentation.title; input('detail').textContent = presentation.detail;
    input('evidence').textContent = check?.checkedAt ? `Checked ${new Date(check.checkedAt).toLocaleString()}${!owner && Number.isFinite(check.similarity) ? ` · similarity ${check.similarity.toFixed(2)} / 100 (not a probability)` : ''}` : '';
    input('controls').hidden = !owner || !check?.available || !['draft', 'changes_requested', 'rejected'].includes(app.status) || check.status === 'matched';
    input('consent').disabled = !allowed(); input('run').disabled = !allowed() || !input('consent').checked;
    input('run').textContent = pending && check?.status !== 'matched' ? 'Please wait…'
      : ['needs_review', 'unavailable'].includes(check?.status) ? 'Try comparison again' : 'Compare my face';
    input('guidance').textContent = dirty ? 'Save your detail changes before comparing photos.'
      : check?.retryAfter > clock() ? `You can try again after ${new Date(check.retryAfter).toLocaleTimeString()}.`
        : owner && !['profile_photo', 'driving_licence'].every((kind) => app.documents.some((doc) => doc.kind === kind)) ? 'Upload both your selfie and the front of your licence first.' : '';
  }
  return Object.freeze({ render, reset });
}
