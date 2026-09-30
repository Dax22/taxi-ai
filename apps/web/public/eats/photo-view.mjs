import { element } from '../dashboard/dom.mjs';

/** Each image owns its fallback and async request; another dish is never reused as a substitute. */
export function createFoodPhoto({ id, version = null, label, className = 'food-meal-photo', load, current = () => true, uri = null }) {
  const frame = element('div', undefined, `${className} food-photo-frame`);
  const placeholder = element('span', 'Photo coming soon', 'food-photo-placeholder');
  placeholder.setAttribute('role', 'img'); placeholder.setAttribute('aria-label', `${label}: photo coming soon`);
  const image = element('img'); image.alt = label; image.hidden = true; image.loading = 'lazy'; image.decoding = 'async';
  frame.append(placeholder, image);
  const failed = () => { image.hidden = true; image.removeAttribute('src'); placeholder.hidden = false; };
  image.addEventListener('error', failed);
  image.addEventListener('load', () => { if (!current()) { failed(); return; } image.hidden = false; placeholder.hidden = true; });
  const show = (source) => { if (source && current()) image.src = source; };
  if (uri) show(uri);
  else if (id) void Promise.resolve().then(() => load(id, version)).then(show).catch(failed);
  return frame;
}

export function photoStatus(photo, label = 'Photo') {
  if (!photo) return `${label} is optional. Customers see “Photo coming soon” until a photo is approved.`;
  if (photo.status === 'rejected') return `${label} needs replacing: ${photo.reviewNote || 'Please upload a clear, accurate image you have permission to use.'}`;
  if (photo.status === 'approved') return `${label} approved and visible to customers.`;
  if (photo.status === 'legacy-approved') return `${label} retained from before the photo review policy. It has not been reviewed under the new policy.`;
  if (photo.status === 'private') return `${label} saved privately for your reference. It is never shown to customers.`;
  return `${label} awaiting staff review. Customers cannot see this upload yet.`;
}
