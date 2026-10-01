// Decorative photography only: no account, booking, location or API dependencies.
const photo = (name, file, small = null) => ({ name, src: `/assets/${file}`, small: small ? `/assets/${small}` : null });
const city = photo('City journeys', 'scenes/ride-city.webp', 'scenes/ride-city-small.webp');
const airport = photo('Airport journeys', 'airport-dropoff-hero.webp', 'airport-dropoff-hero-small.webp');
const food = photo('Nigerian favourites', 'scenes/eats-table.webp', 'scenes/eats-table-small.webp');
const courier = photo('A friendly delivery', 'scenes/courier-handoff.webp', 'scenes/courier-handoff-small.webp');
const kitchen = photo('From the kitchen', 'scenes/kitchen.webp', 'scenes/kitchen-small.webp');
const themes = {
  rides: [city, airport], courier: [courier, city, airport], account: [city, food, courier], family: [city, airport],
  food: [food, photo('Jollof at the table', 'eats-jollof.jpg'), photo('Freshly prepared suya', 'eats-suya.jpg')],
  kitchen: [kitchen, food, photo('Ready for delivery', 'food-delivery-hero.webp', 'food-delivery-hero-small.webp')],
};
const instances = new WeakMap();

export function createPageScene(root, { documentRef = root?.ownerDocument, windowRef = documentRef?.defaultView, intervalMs = 11000 } = {}) {
  if (!root || !documentRef || !windowRef || !themes[root.dataset.pageScene]) return null;
  if (instances.has(root)) return instances.get(root);
  const fallback = root.querySelector('.page-scene-image');
  if (!fallback) return null;
  const motion = windowRef.matchMedia?.('(prefers-reduced-motion: reduce)');
  const delay = Math.max(9000, Number.isFinite(intervalMs) ? intervalMs : 11000);
  const listeners = [], created = new Set(), failed = new Set();
  let theme = root.dataset.pageScene, scenes = themes[theme], current = 0, active = fallback, previousImage = null;
  let playing = !motion?.matches, visible = !windowRef.IntersectionObserver, pageActive = true, destroyed = false;
  let timer = null, prepared = null, pending = null, pointerAction = null, themePending = false;
  current = Math.max(0, scenes.findIndex(item => item.src === fallback.getAttribute('src')?.split('?')[0]));
  const controls = documentRef.createElement('div');
  controls.className = 'page-scene-controls'; controls.dataset.sceneControls = '';
  controls.setAttribute('role', 'group'); controls.setAttribute('aria-label', 'Background photo controls');
  const button = (key, label, glyph) => {
    const node = documentRef.createElement('button'); node.type = 'button'; node.dataset[key] = '';
    node.setAttribute('aria-label', label); node.title = label;
    const icon = documentRef.createElement('span'); icon.setAttribute('aria-hidden', 'true'); icon.textContent = glyph;
    node.append(icon); controls.append(node); return node;
  };
  const play = button('scenePlay', 'Pause background photos', 'Ⅱ');
  const previous = button('scenePrevious', 'Previous background photo', '←');
  const next = button('sceneNext', 'Next background photo', '→');
  const status = documentRef.createElement('span');
  status.className = 'page-scene-status'; status.dataset.sceneStatus = '';
  status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true');
  root.append(controls, status); fallback.dataset.sceneCurrent = 'true';

  const listen = (target, type, handler) => {
    target.addEventListener(type, handler); listeners.push(() => target.removeEventListener(type, handler));
  };
  const available = () => !destroyed && pageActive && visible && !documentRef.hidden && !root.hidden;
  const automatic = () => available() && playing && !motion?.matches;
  function clearTimer() { if (timer !== null) windowRef.clearTimeout(timer); timer = null; }
  function cancelPrepared() { prepared?.cleanup(); prepared = null; pending = null; }
  function nextIndex(direction = 1, skipFailed = false) {
    for (let step = 1; step < scenes.length; step++) {
      const index = (current + direction * step + scenes.length) % scenes.length;
      if (!skipFailed || !failed.has(index)) return index;
    }
    return current;
  }
  function sync() {
    clearTimer();
    root.dataset.scenePlaying = String(automatic()); root.dataset.sceneIndex = String(current);
    root.dataset.sceneReducedMotion = String(Boolean(motion?.matches));
    play.disabled = Boolean(motion?.matches);
    const label = motion?.matches ? 'Automatic photos off: reduced motion is enabled' : playing ? 'Pause background photos' : 'Play background photos';
    play.setAttribute('aria-label', label); play.title = label;
    play.firstElementChild.textContent = motion?.matches ? '−' : playing ? 'Ⅱ' : '▶';
    if (available() && themePending) { if (!pending) show(0, false, true); return; }
    if (!automatic()) return;
    const index = nextIndex(1, true);
    if (index === current) return;
    prepare(index);
    timer = windowRef.setTimeout(() => { timer = null; show(index, false); }, delay);
  }
  function commit(record) {
    const request = pending;
    if (record !== prepared || !record.ready || !request || request.index !== record.index || !available()
      || !request.manual && !automatic() && !request.themeChange) return;
    pending = null;
    if (request.themeChange) themePending = false;
    if (previousImage && previousImage !== fallback) { previousImage.remove(); created.delete(previousImage); }
    previousImage = active; active.dataset.sceneCurrent = 'false';
    active = record.image; active.dataset.sceneCurrent = 'true'; active.className = 'page-scene-image page-scene-image-enter';
    root.append(active); created.add(active); current = record.index;
    record.cleanup(); prepared = null;
    if (request.manual) status.textContent = `${scenes[current].name}. Photo ${current + 1} of ${scenes.length}.`;
    sync();
  }
  function prepare(index) {
    if (prepared?.index === index) return prepared;
    cancelPrepared();
    const image = documentRef.createElement('img'), item = scenes[index];
    image.className = 'page-scene-image'; image.alt = ''; image.setAttribute('aria-hidden', 'true');
    image.decoding = 'async'; image.loading = 'eager'; image.fetchPriority = 'low';
    const record = { index, image, ready: false, cleanup: () => { image.removeEventListener('load', loaded); image.removeEventListener('error', errored); } };
    function loaded() {
      if (destroyed || prepared !== record) return;
      record.ready = true; failed.delete(index); record.cleanup(); commit(record);
    }
    function errored() {
      if (destroyed || prepared !== record) return;
      const manual = pending?.manual; failed.add(index); themePending = false; cancelPrepared();
      if (manual) status.textContent = 'That background photo could not load. The current photo is unchanged.';
      sync();
    }
    prepared = record; image.addEventListener('load', loaded); image.addEventListener('error', errored);
    // Only the next photo is requested. Choose the small file before assigning src.
    image.src = item.small && windowRef.matchMedia?.('(max-width: 800px)').matches ? item.small : item.src;
    if (image.complete && image.naturalWidth > 0) loaded();
    return record;
  }
  function show(index, manual, themeChange = false) {
    if (destroyed) return;
    if (manual) { playing = false; themePending = false; failed.delete(index); }
    clearTimer();
    const record = prepare(index);
    pending = { index, manual, themeChange };
    commit(record);
    if (pending) syncPending();
  }
  function syncPending() {
    // Loading must not expose a blank layer or start another rotation timer.
    root.dataset.scenePlaying = String(automatic());
    const label = playing ? 'Pause background photos' : 'Play background photos';
    if (!motion?.matches) { play.setAttribute('aria-label', label); play.title = label; play.firstElementChild.textContent = playing ? 'Ⅱ' : '▶'; }
  }
  function stopAutomatic() { playing = false; if (pending && !pending.manual) pending = null; sync(); }
  function visibilityChanged() { if (!available()) pending = null; sync(); }
  function setTheme(value) {
    if (destroyed || !themes[value] || value === theme) return;
    theme = value; scenes = themes[value]; root.dataset.pageScene = value;
    failed.clear(); cancelPrepared(); clearTimer();
    // Preserve the current valid photo until the new theme's first image is ready.
    current = 0; themePending = true; root.dataset.sceneIndex = '0';
    if (available()) show(0, false, true); else sync();
  }
  listen(previous, 'click', () => show(nextIndex(-1), true));
  listen(next, 'click', () => show(nextIndex(1), true));
  listen(play, 'pointerdown', () => { pointerAction = !playing; });
  listen(play, 'pointercancel', () => { pointerAction = null; });
  listen(play, 'blur', () => { pointerAction = null; });
  listen(play, 'click', event => {
    if (motion?.matches) return;
    playing = event.detail > 0 && pointerAction !== null ? pointerAction : !playing;
    pointerAction = null; if (!playing && pending && !pending.manual) pending = null; sync();
  });
  listen(root, 'focusin', stopAutomatic);
  listen(documentRef, 'visibilitychange', visibilityChanged);
  listen(windowRef, 'pagehide', () => { pageActive = false; pending = null; sync(); });
  listen(windowRef, 'pageshow', () => { pageActive = true; sync(); });
  if (motion?.addEventListener) listen(motion, 'change', stopAutomatic);
  const observer = windowRef.IntersectionObserver ? new windowRef.IntersectionObserver(entries => {
    visible = entries.some(entry => entry.target === root && entry.isIntersecting); visibilityChanged();
  }, { threshold: 0.01 }) : null;
  observer?.observe(root);
  const attributes = windowRef.MutationObserver ? new windowRef.MutationObserver(() => setTheme(root.dataset.pageScene)) : null;
  attributes?.observe(root, { attributes: true, attributeFilter: ['data-page-scene'] });
  if (root.contains(documentRef.activeElement)) playing = false;
  sync();
  const controller = { setTheme, destroy() {
    if (destroyed) return;
    destroyed = true; clearTimer(); cancelPrepared(); observer?.disconnect(); attributes?.disconnect();
    listeners.forEach(remove => remove()); created.forEach(image => image.remove()); controls.remove(); status.remove();
    delete fallback.dataset.sceneCurrent;
    for (const key of ['scenePlaying', 'sceneIndex', 'sceneReducedMotion']) delete root.dataset[key];
    instances.delete(root);
  } };
  instances.set(root, controller); return controller;
}

if (typeof document !== 'undefined') document.querySelectorAll('[data-page-scene]').forEach(root => createPageScene(root));
