import { vehiclePresentation } from '/shared/vehicle-profile.mjs';
import { element } from './dom.mjs';

const rendered = new WeakMap();
/** Text-only identity fields and allowlisted artwork; evidence uploads are never public image URLs. */
export function renderVehicleCard(container, vehicle, { label = 'YOUR VEHICLE', compact = false } = {}) {
  if (!vehicle) { container.replaceChildren(); container.hidden = true; rendered.delete(container); return; }
  const value = vehiclePresentation(vehicle), key = JSON.stringify([value,label,compact]);
  container.hidden = false;
  if (rendered.get(container) === key) return;
  rendered.set(container,key);
  const card = element('article', undefined, `vehicle-card${compact ? ' vehicle-card-compact' : ''}`);
  const art = element('div', undefined, 'vehicle-card-art'), img = element('img');
  img.src = value.assetPath; img.alt = ''; img.width = 640; img.height = 380; img.decoding = 'async';
  art.append(img);
  const info = element('div', undefined, 'vehicle-card-info'), plate = element('p', value.plate, 'vehicle-plate');
  plate.setAttribute('aria-label', `Number plate ${value.plate}`);
  info.append(element('p', label, 'eyebrow'), element('h3', value.title), element('p', value.description, 'vehicle-description'), plate,
    element('p', value.illustrationNote, 'small-note'));
  card.append(art,info); container.replaceChildren(card);
}
