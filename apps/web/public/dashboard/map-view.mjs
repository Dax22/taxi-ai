import { ABUJA_CENTER, ABUJA_BOUNDS, project, unproject } from '/shared/locations.mjs';
import { element } from './dom.mjs';

/** Small raster map: visible tiles only, native browser caching, no SDK or telemetry. */
export function createMapView(root, { onPick } = {}) {
  const width = 800, height = 400, namespace = 'http://www.w3.org/2000/svg';
  const svg = (tag, attrs = {}, text) => {
    const node = document.createElementNS(namespace, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const frame = element('div', undefined, 'map-frame'), controls = element('div', undefined, 'map-controls');
  const canvas = svg('svg', { viewBox: `0 0 ${width} ${height}`, role: 'group', tabindex: '0',
    'aria-label': onPick ? 'Abuja map. Arrow keys pan, plus or minus zoom. Enter selects the centre point.' : 'Journey map. Arrow keys pan; plus or minus zoom.' });
  const tiles = svg('g'), overlay = svg('g'), note = element('p', '', 'small-note map-status');
  canvas.append(tiles, overlay); frame.append(canvas); root.append(controls, frame, note);
  let state = { enabled: false }, center = { ...ABUJA_CENTER }, zoom = 11, focusKey = null, tileKey = '', generation = 0, tileError = false;
  function constrain(value) { return { lat: Math.max(ABUJA_BOUNDS.south, Math.min(ABUJA_BOUNDS.north, value.lat)), lng: Math.max(ABUJA_BOUNDS.west, Math.min(ABUJA_BOUNDS.east, value.lng)) }; }
  function fit(points) {
    if (!points.length) { center = { ...ABUJA_CENTER }; zoom = 11; return; }
    if (points.length === 1) { center = constrain(points[0]); zoom = 14; return; }
    for (zoom = 17; zoom >= 9; zoom--) {
      const pixels = points.map((p) => project(p, zoom));
      const left = Math.min(...pixels.map((p) => p.x)), right = Math.max(...pixels.map((p) => p.x));
      const top = Math.min(...pixels.map((p) => p.y)), bottom = Math.max(...pixels.map((p) => p.y));
      center = constrain(unproject({ x: (left + right) / 2, y: (top + bottom) / 2 }, zoom));
      if (right - left <= width - 160 && bottom - top <= height - 120) return;
    }
    zoom = 9;
  }
  function render() {
    frame.hidden = controls.hidden = !state.enabled;
    if (!state.enabled) { generation++; tiles.replaceChildren(); overlay.replaceChildren(); tileKey = ''; tileError = false; note.textContent = 'Enable online maps to view streets and select pins.'; return; }
    const middle = project(center, zoom), origin = { x: middle.x - width / 2, y: middle.y - height / 2 };
    const screen = (point) => { const p = project(point, zoom); return { x: p.x - origin.x, y: p.y - origin.y }; };
    const nextKey = JSON.stringify([state.tiles, center, zoom]);
    if (tileKey !== nextKey) {
      const epoch = ++generation;
      tileKey = nextKey; tileError = false; tiles.replaceChildren();
      for (let x = Math.floor(origin.x / 256); x <= Math.floor((origin.x + width) / 256); x++) {
        for (let y = Math.floor(origin.y / 256); y <= Math.floor((origin.y + height) / 256); y++) {
          const tile = svg('image', { x: x * 256 - origin.x, y: y * 256 - origin.y, width: 256, height: 256,
            href: state.tiles.replace('{z}', zoom).replace('{x}', x).replace('{y}', y) });
          tile.addEventListener('error', () => { if (epoch === generation) { tileError = true; render(); } });
          tiles.append(tile);
        }
      }
    }
    note.textContent = tileError ? 'Street tiles could not load. Route details and coordinate controls remain available.'
      : `Map centre ${center.lat.toFixed(5)}, ${center.lng.toFixed(5)} · zoom ${zoom}. ${onPick ? 'Click the map or select its centre to place a pin.' : 'P: pickup · D: destination · V: driver.'}`;
    overlay.replaceChildren();
    if (state.route?.length) {
      const path = state.route.map(([lng, lat]) => { const p = screen({ lat, lng }); return `${p.x},${p.y}`; }).join(' ');
      overlay.append(svg('polyline', { points: path, class: 'map-route-halo' }), svg('polyline', { points: path, class: 'map-route-line' }));
    }
    for (const [point, label, type] of [[state.pickup, 'P', 'pickup'], [state.destination, 'D', 'destination'], [state.driver, 'V', state.stale ? 'stale' : 'driver']]) {
      if (!point) continue;
      const p = screen(point), marker = svg('g', { transform: `translate(${p.x} ${p.y})`, class: `map-marker map-marker-${type}` });
      marker.append(svg('circle', { r: 14 }), svg('text', { 'text-anchor': 'middle', dy: '5' }, label), svg('title', {}, `${label}: ${point.name ?? 'Driver-reported location'}`));
      overlay.append(marker);
    }
    if (onPick) overlay.append(svg('path', { d: `M390 200h20M400 190v20`, class: 'map-crosshair' }));
  }
  function move(dx, dy) { if (!state.enabled) return; const p = project(center, zoom); center = constrain(unproject({ x: p.x + dx, y: p.y + dy }, zoom)); render(); }
  function scale(amount) { if (!state.enabled) return; zoom = Math.max(9, Math.min(17, zoom + amount)); render(); }
  for (const [label, action] of [['Zoom in', () => scale(1)], ['Zoom out', () => scale(-1)], ['West', () => move(-160, 0)],
    ['East', () => move(160, 0)], ['North', () => move(0, -120)], ['South', () => move(0, 120)],
    ...(onPick ? [['Use centre point', () => onPick({ ...center })]] : [])]) {
    const button = element('button', label, 'button button-outline button-small'); button.type = 'button';
    button.addEventListener('click', action); controls.append(button);
  }
  canvas.addEventListener('click', (event) => {
    if (!state.enabled || !onPick) return;
    const rect = canvas.getBoundingClientRect(), middle = project(center, zoom);
    onPick(unproject({ x: middle.x - width / 2 + (event.clientX - rect.left) / rect.width * width,
      y: middle.y - height / 2 + (event.clientY - rect.top) / rect.height * height }, zoom));
  });
  canvas.addEventListener('keydown', (event) => {
    const actions = { ArrowLeft: () => move(-80, 0), ArrowRight: () => move(80, 0), ArrowUp: () => move(0, -80), ArrowDown: () => move(0, 80),
      '+': () => scale(1), '=': () => scale(1), '-': () => scale(-1), Enter: () => { if (state.enabled) onPick?.({ ...center }); } };
    if (Object.hasOwn(actions, event.key)) { event.preventDefault(); actions[event.key](); }
  });
  return Object.freeze({
    render(next) {
      state = next;
      if (focusKey !== next.focusKey) { focusKey = next.focusKey; fit([next.pickup, next.destination].filter(Boolean)); }
      render();
    },
    reset() { state = { enabled: false }; center = { ...ABUJA_CENTER }; zoom = 11; focusKey = null; render(); },
  });
}
