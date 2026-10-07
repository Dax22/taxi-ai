import { el } from './ui.mjs';

/** Historical evidence and current observations remain distinct; map loading is optional. */
export function safetyAlertMap(position, map, { historical = true } = {}) {
  const box = el('section', null, 'transaction-map', { 'aria-label': historical ? 'Recorded incident location' : 'Last requested driver location' });
  if (!position || !Number.isFinite(position.lat) || Math.abs(position.lat) > 90 || !Number.isFinite(position.lng) || Math.abs(position.lng) > 180) {
    box.append(el('p', 'Location unavailable. No position has been inferred.')); return box;
  }
  box.append(el('p', `Latitude ${position.lat.toFixed(5)}; longitude ${position.lng.toFixed(5)}.`),
    el('p', historical ? 'Saved incident snapshot — never a live marker.' : 'Observation at the displayed capture time, not a continuously live feed. Refresh to recheck sharing access.', 'definition-note'));
  if (!map?.enabled || typeof map.tiles !== 'string' || Math.abs(position.lat) > 85.05112878) {
    box.append(el('p', 'Street tiles are unavailable for this view; recorded coordinates remain visible.')); return box;
  }
  let example;
  try { example = new URL(map.tiles.replace('{z}', '1').replace('{x}', '1').replace('{y}', '1')); } catch { return box; }
  if (example.protocol !== 'https:' || example.username || example.password || example.hash || !['{z}', '{x}', '{y}'].every(t => map.tiles.split(t).length === 2)) return box;
  const button = el('button', 'Show street map', 'button secondary', { type: 'button' });
  box.append(el('p', 'Opening the map shares the displayed map area with the configured tile provider. It does not activate your camera, microphone or GPS.', 'definition-note'), button);
  button.addEventListener('click', () => {
    button.disabled = true;
    const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 768 768'); svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', historical ? 'Map of saved incident position' : 'Map of last requested driver position');
    const zoom = 15, n = 2 ** zoom, x = (position.lng + 180) / 360 * n, sin = Math.sin(position.lat * Math.PI / 180);
    const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * n, left = Math.floor(x) - 1, top = Math.floor(y) - 1;
    let warned = false;
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) {
      const yy = top + dy; if (yy < 0 || yy >= n) continue;
      const image = document.createElementNS(ns, 'image');
      for (const [key, value] of Object.entries({ x: dx * 256, y: dy * 256, width: 256, height: 256 })) image.setAttribute(key, String(value));
      image.setAttribute('href', map.tiles.replace('{z}', String(zoom)).replace('{x}', String(((left + dx) % n + n) % n)).replace('{y}', String(yy)));
      image.addEventListener('error', () => { if (!warned) { warned = true; box.append(el('p', 'Street tiles failed to load. Use the recorded coordinates; do not infer a location from missing tiles.')); } });
      svg.append(image);
    }
    const pin = document.createElementNS(ns, 'circle'); pin.setAttribute('cx', String((x - left) * 256)); pin.setAttribute('cy', String((y - top) * 256));
    pin.setAttribute('r', '10'); pin.setAttribute('class', historical || position.stale ? 'location-marker stale' : 'location-marker'); svg.append(pin);
    box.append(svg, el('p', 'Map data © OpenStreetMap contributors. Phone-reported location may be inaccurate.', 'definition-note')); button.hidden = true;
  }, { once: true });
  return box;
}
