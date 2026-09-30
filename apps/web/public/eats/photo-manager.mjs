import { $, element } from '../dashboard/dom.mjs';
import { createFoodPhoto, photoStatus } from './photo-view.mjs';
import { prepareFoodPhoto } from './photo-upload.mjs';

const fields = [
  { purpose: 'logo', key: 'logo', title: 'Kitchen logo', description: 'Use your own business logo or one you have permission to display.' },
  { purpose: 'cover', key: 'cover', title: 'Kitchen cover photo', description: 'Show food you actually sell. Match the portions and included sides; avoid people, private home addresses and personal details.' },
  { purpose: 'menu_reference', key: 'menuReference', title: 'Printed menu reference', description: 'Optional private photo for you to consult while adding dishes. It is not published or automatically converted into menu items. Add each dish’s name, price, description, allergen notes and availability separately.' },
];

export function createPhotoManager(controller, { prepare = prepareFoodPhoto, onChange = () => {} } = {}) {
  let state, owner, lifecycle = 0, reviewKey = '', reviewDrafts = new Map();
  const editors = new Map(), locked = () => state?.busy || state?.uncertain || state?.stale;
  const root = $('food-store-photos'), reviewRoot = $('food-photo-review-list');
  function clearEditor(editor) {
    editor.epoch++; editor.photo = editor.preview = null; editor.dirty = editor.removed = editor.reading = false; editor.error = ''; editor.gallery.value = editor.camera.value = ''; editor.key = '';
  }
  function renderEditor(editor) {
    const asset = state?.store?.assets?.[editor.keyName], key = JSON.stringify([asset, editor.preview, editor.removed, editor.epoch, owner]);
    if (key !== editor.key) {
      editor.key = key; const epoch = editor.epoch, generation = lifecycle;
      editor.frame.replaceChildren(createFoodPhoto({ id: editor.removed ? null : asset?.id, version: asset?.version, uri: editor.preview, label: editor.title, className: 'food-photo-edit', load: controller.photo, current: () => generation === lifecycle && editor.epoch === epoch }));
    }
    editor.status.textContent = editor.error || (editor.reading ? 'Processing your photo…' : editor.removed ? 'Save to remove this image.' : editor.photo ? (editor.purpose === 'menu_reference' ? 'New reference selected. Save it privately.' : 'New photo selected. Save to submit it for staff review.') : photoStatus(asset, editor.title));
    editor.fieldset.disabled = Boolean(locked() || editor.reading);
    editor.save.disabled = Boolean(locked() || editor.reading || !editor.dirty);
    editor.remove.disabled = Boolean(locked() || editor.reading || !editor.photo && (!asset || editor.removed));
    editor.reload.hidden = !editor.dirty;
    editor.stale.hidden = !editor.dirty || editor.version === state?.store?.version;
  }
  for (const { purpose, key, title, description } of fields) {
    const form = element('form', undefined, 'food-photo-editor'), fieldset = element('fieldset');
    const frame = element('div'), status = element('p', undefined, 'small-note'); status.setAttribute('role', 'status');
    const gallery = element('input'), camera = element('input');
    const editor = { purpose, keyName: key, title, fieldset, frame, status, gallery, camera, epoch: 0, key: '' };
    fieldset.append(element('legend', title), element('p', description, 'small-note'), frame);
    for (const [input, suffix, label] of [[gallery, 'gallery', 'Choose photo'], [camera, 'camera', 'Take photo']]) {
      input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp'; input.id = `food-${purpose}-${suffix}`;
      if (suffix === 'camera') input.setAttribute('capture', 'environment');
      const caption = element('label', label); caption.setAttribute('for', input.id); fieldset.append(caption, input);
      input.addEventListener('change', async () => {
        if (locked() || editor.reading) return;
        const file = input.files?.[0]; if (!file) return;
        const epoch = ++editor.epoch, generation = lifecycle; editor.reading = true; editor.error = ''; renderEditor(editor); onChange();
        try {
          const result = await prepare(file);
          if (epoch !== editor.epoch || generation !== lifecycle) return;
          if (!editor.dirty) editor.version = state.store.version;
          editor.photo = result.photo; editor.preview = result.preview; editor.dirty = true; editor.removed = false;
        } catch (error) { if (epoch === editor.epoch && generation === lifecycle) editor.error = error?.message || 'Could not process that photo. Choose it again.'; }
        finally { if (epoch === editor.epoch && generation === lifecycle) { editor.reading = false; input.value = ''; renderEditor(editor); onChange(); } }
      });
    }
    const actions = element('div', undefined, 'food-actions');
    for (const [key, label] of [['save', 'Save image'], ['remove', 'Remove image'], ['reload', 'Discard photo changes']]) {
      const button = element('button', label, `button ${key === 'save' ? 'button-primary' : 'button-outline'}`); button.type = key === 'save' ? 'submit' : 'button'; editor[key] = button; actions.append(button);
    }
    editor.remove.addEventListener('click', () => { if (locked() || editor.reading) return; if (!editor.dirty) editor.version = state.store.version; editor.epoch++; editor.photo = editor.preview = null; editor.dirty = editor.removed = true; editor.error = ''; renderEditor(editor); });
    editor.reload.addEventListener('click', () => { if (locked()) return; clearEditor(editor); renderEditor(editor); });
    editor.stale = element('p', 'Store details changed. Discard photo changes and choose the image again before saving.', 'food-error'); editor.stale.hidden = true;
    form.addEventListener('submit', async (event) => {
      event.preventDefault(); if (locked() || editor.reading || !editor.dirty) return;
      if (editor.version !== state.store.version) { editor.stale.hidden = false; return; }
      const generation = lifecycle, epoch = editor.epoch;
      const ok = await controller.storeAction('assets', { expectedVersion: editor.version, purpose, image: editor.removed ? null : editor.photo });
      if (ok && generation === lifecycle && epoch === editor.epoch) { clearEditor(editor); renderEditor(editor); }
    });
    fieldset.append(status, editor.stale, actions); form.append(fieldset); root.append(form); editors.set(purpose, editor); clearEditor(editor);
  }
  $('food-photo-review-filter').addEventListener('change', () => { if (!locked()) void controller.loadPhotoReviews($('food-photo-review-filter').value); });
  $('food-photo-review-more').addEventListener('click', () => { if (!locked()) void controller.loadPhotoReviews(state.photoReviewStatus, state.photoNextBefore); });

  return {
    busy: () => [...editors.values()].some((editor) => editor.reading),
    render(next) {
      state = next;
      if (owner !== state.user?.id) { owner = state.user?.id; lifecycle++; reviewKey = ''; reviewDrafts.clear(); reviewRoot.replaceChildren(); for (const editor of editors.values()) clearEditor(editor); }
      root.hidden = !state.store || state.user?.role === 'admin';
      for (const editor of editors.values()) renderEditor(editor);
      const review = state.user?.role === 'admin' && state.screen === 'review';
      $('food-photo-review-section').hidden = !review;
      $('food-photo-review-filter').value = state.photoReviewStatus ?? 'pending'; $('food-photo-review-filter').disabled = Boolean(locked() || state.loading);
      $('food-photo-review-more').hidden = !state.photoNextBefore; $('food-photo-review-more').disabled = Boolean(locked() || state.loading);
      const key = JSON.stringify([review, state.reviewPhotos, locked()]);
      if (key === reviewKey) return; reviewKey = key; reviewRoot.replaceChildren();
      if (!review) return;
      if (!state.reviewPhotos?.length) reviewRoot.append(element('p', 'No photos in this review queue.', 'food-notice'));
      for (const asset of state.reviewPhotos ?? []) {
        const card = element('article', undefined, 'food-card'), title = asset.itemName || `${asset.storeName} ${asset.purpose}`;
        const generation = lifecycle;
        card.append(element('h3', title), element('p', `${asset.storeName} · ${asset.purpose} · ${asset.status}`, 'small-note'), createFoodPhoto({ id: asset.id, version: asset.version, label: title, className: 'food-review-photo', load: controller.photo, current: () => generation === lifecycle }), element('p', photoStatus(asset)));
        const form = element('form'), reason = element('textarea'), label = element('label', 'Review reason'), error = element('p', undefined, 'food-error'); error.setAttribute('role', 'alert');
        const draftKey = `${asset.id}:${asset.version}`;
        reason.id = `food-photo-reason-${asset.id}`; reason.required = true; reason.minLength = 10; reason.maxLength = 500; reason.rows = 3; reason.value = reviewDrafts.get(draftKey) ?? ''; reason.disabled = Boolean(locked()); label.setAttribute('for', reason.id);
        reason.addEventListener('input', () => reviewDrafts.set(draftKey, reason.value));
        const actions = element('div', undefined, 'food-actions');
        for (const [decision, caption] of [['approved', 'Approve photo'], ['rejected', 'Reject photo']]) { const button = element('button', caption, `button ${decision === 'approved' ? 'button-primary' : 'button-outline'}`); button.type = 'submit'; button.value = decision; button.disabled = Boolean(locked()); actions.append(button); }
        form.addEventListener('submit', async (event) => {
          event.preventDefault(); if (locked()) return;
          const decision = event.submitter?.value, note = reason.value.trim();
          if (!['approved', 'rejected'].includes(decision)) return;
          if (note.length < 10 || note.length > 500) { error.textContent = 'Give a review reason between 10 and 500 characters.'; return; }
          if (await controller.reviewPhoto(asset, decision, note)) reviewDrafts.delete(draftKey);
        });
        form.append(label, reason, error, actions); card.append(form); reviewRoot.append(card);
      }
    },
  };
}
