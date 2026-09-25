import { el } from './ui.mjs';

/** Mutations carry only explicitly named fields; no HTML interpolation or ambient form serialization. */
export function actionForm({ title, action, fields = [], submit = 'Save changes', data = {}, danger = false }) {
  const form = el('form', null, 'action-form', { 'data-action': action, 'aria-label': title });
  const idPrefix = 'action-' + Math.random().toString(36).slice(2);
  if (title) form.append(el('h3', title));
  form.actionData = data;
  for (const [index, spec] of fields.entries()) {
    const id = `${idPrefix}-${index}`, field = el('div', null, 'field'), attributes = { id, name: spec.name };
    if (spec.required !== false) attributes.required = '';
    if (spec.min != null) attributes.minlength = spec.min;
    if (spec.max != null) attributes.maxlength = spec.max;
    field.append(el('label', spec.label, '', { for: id }));
    const input = el(spec.options ? 'select' : spec.multiline ? 'textarea' : 'input', null, '', attributes);
    if (spec.options) for (const [value, label] of spec.options) input.append(el('option', label, '', { value }));
    else { if (!spec.multiline) input.setAttribute('type', spec.type ?? 'text'); input.setAttribute('autocomplete', spec.autocomplete ?? 'off'); }
    if (spec.placeholder) input.setAttribute('placeholder', spec.placeholder);
    if (spec.value != null) input.value = spec.value;
    field.append(input); if (spec.help) field.append(el('p', spec.help, 'small muted')); form.append(field);
  }
  form.append(el('button', submit, `button ${danger ? 'danger' : 'primary'}`, { type: 'submit' })); return form;
}
export function formPayload(form) {
  const payload = { ...form.actionData };
  for (const field of form.elements) {
    if (!field.name || field.disabled) continue;
    payload[field.name] = field.name === 'assigneeId' && !field.value ? null : field.value;
  }
  return payload;
}
export const reasonField = { name: 'reason', label: 'Reason for this action', min: 5, max: 500, multiline: true };
