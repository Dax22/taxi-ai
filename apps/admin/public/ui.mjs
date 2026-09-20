import { RIDE_STATUS_LABELS } from '/shared/trip-lifecycle.mjs';

export const $ = (id) => document.getElementById(id);
export function el(tag, text = null, className = '', attributes = {}) {
  const node = document.createElement(tag); if (text !== null) node.textContent = String(text);
  if (className) node.className = className;
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}
export function money(value) {
  if (value == null) return '—'; const kobo = BigInt(value), sign = kobo < 0n ? '−' : '', amount = kobo < 0n ? -kobo : kobo;
  return `${sign}₦${(amount / 100n).toLocaleString('en-NG')}.${String(amount % 100n).padStart(2, '0')}`;
}
export const count = (value) => new Intl.NumberFormat('en-NG').format(value);
export const percent = (value) => value == null ? '—' : new Intl.NumberFormat('en-NG', { style: 'percent', maximumFractionDigits: 1 }).format(value);
export function date(value, time = true) {
  if (value == null) return '—';
  return new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', year: 'numeric', month: 'short', day: 'numeric',
    ...(time ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(new Date(value));
}
export const shortDay = (day) => new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short' }).format(new Date(day + 'T00:00:00+01:00'));
export function link(text, href, className = 'cell-link') { return el('a', text, className, { href }); }
export function badge(status) {
  const labels = { customer: 'Customer', driver: 'Customer + driver', draft: 'Draft', submitted: 'Awaiting review', changes_requested: 'Corrections requested',
    approved: 'Approved', rejected: 'Rejected', pending: 'Pending', failed: 'Failed', paid: 'Paid · simulated', unpaid: 'Unpaid', not_due: 'Not due', agreed: 'Fare agreed' };
  return el('span', labels[status] ?? RIDE_STATUS_LABELS[status] ?? status, `badge ${/^[a-z_]+$/.test(status) ? status : ''}`);
}
export function avatar(name) { return el('span', name.trim().split(/\s+/).slice(0, 2).map((word) => word[0] ?? '').join('').toUpperCase(), 'avatar', { 'aria-hidden': 'true' }); }
export function panel(title, subtitle = '', action = null) {
  const box = el('section', null, 'panel'), header = el('div', null, 'panel-header'), intro = el('div');
  intro.append(el('h2', title)); if (subtitle) intro.append(el('p', subtitle)); header.append(intro); if (action) header.append(action);
  box.append(header); return box;
}
export function cards(items) {
  const row = el('div', null, 'cards');
  for (const [label, value, note, featured] of items) {
    const card = el('section', null, `metric${featured ? ' featured' : ''}`);
    card.append(el('p', label, 'metric-label'), el('strong', value), el('p', note, 'metric-note')); row.append(card);
  }
  return row;
}
export function table(headers, rows, caption = '') {
  const wrap = el('div', null, 'table-scroll', { tabindex: '0', role: 'region', 'aria-label': caption || headers.join(', ') });
  const node = el('table'), head = el('thead'), headRow = el('tr'), body = el('tbody');
  if (caption) node.append(el('caption', caption));
  for (const title of headers) headRow.append(el('th', title, '', { scope: 'col' })); head.append(headRow);
  for (const row of rows) { const tr = el('tr'); for (const cell of row) { const td = el('td'); td.append(typeof cell === 'object' ? cell : document.createTextNode(String(cell ?? '—'))); tr.append(td); } body.append(tr); }
  node.append(head, body); wrap.append(node); return wrap;
}
export function empty(title, description) { const box = el('div', null, 'empty'); box.append(el('strong', title), el('p', description)); return box; }
export function pagination(page, route, length) {
  const row = el('div', null, 'pagination'), controls = el('div');
  row.append(el('span', `${count(length)} records on this page`));
  for (const [label, key, value] of [['← Previous', 'after', page.previous], ['Next →', 'before', page.next]]) {
    if (value) { const params = new URLSearchParams(route.query); params.delete('before'); params.delete('after'); params.set(key, value); controls.append(link(label, route.path + '?' + params, 'button secondary')); }
  }
  controls.append(link('First page', route.path + (cleanPages(route.query).size ? '?' + cleanPages(route.query) : ''), 'button quiet'));
  row.append(controls); return row;
}
function cleanPages(query) { const result = new URLSearchParams(query); result.delete('before'); result.delete('after'); return result; }
export function filterForm(route, specs, values = {}) {
  const form = el('form', null, 'filters', { method: 'get', action: route.path, 'aria-label': 'Filter this page' });
  for (const spec of specs) {
    const { name, label, options, type = 'text', placeholder = '' } = spec;
    const field = el('div', null, `field${type === 'search' ? ' search-field' : ''}`), id = `filter-${name}`;
    field.append(el('label', label, '', { for: id }));
    const input = el(options ? 'select' : 'input', null, '', { id, name });
    if (options) for (const [value, text] of options) input.append(el('option', text, '', { value }));
    else { input.setAttribute('type', type); if (placeholder) input.setAttribute('placeholder', placeholder); if (type === 'search') input.setAttribute('maxlength', '100'); }
    input.value = route.query.get(name) ?? values[name] ?? ''; field.append(input); form.append(field);
  }
  const actions = el('div', null, 'filter-actions');
  actions.append(el('button', 'Apply', 'button primary', { type: 'submit' }), link('Reset', route.path, 'button quiet')); form.append(actions); return form;
}
export function detailsList(entries, className = 'details-list') {
  const dl = el('dl', null, className);
  for (const [label, value] of entries) { const group = el('div'), dd = el('dd'); dd.append(typeof value === 'object' && value !== null ? value : document.createTextNode(String(value ?? '—'))); group.append(el('dt', label), dd); dl.append(group); }
  return dl;
}
export function person(user) {
  if (!user) return el('span', 'Unassigned', 'muted');
  const box = el('div', null, 'person-cell'), info = el('div'); info.append(link(user.name, '/admin/accounts/' + encodeURIComponent(user.id)));
  info.append(el('span', user.id.slice(0, 8).toUpperCase(), 'subtext')); box.append(avatar(user.name), info); return box;
}
