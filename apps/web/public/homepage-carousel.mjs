// This presentation component has no connection to booking or selected services.
export function createHomepageCarousel(root, {
  documentRef = root?.ownerDocument,
  windowRef = documentRef?.defaultView,
  intervalMs = 6500,
} = {}) {
  if (!root || !documentRef || !windowRef) return null;
  const slides = [...root.querySelectorAll('[data-carousel-slide]')];
  const controls = root.querySelector('[data-carousel-controls]');
  const rotation = root.querySelector('[data-carousel-rotation]');
  const previous = root.querySelector('[data-carousel-previous]');
  const next = root.querySelector('[data-carousel-next]');
  const status = root.querySelector('[data-carousel-status]');
  if (slides.length < 2 || !controls || !rotation || !previous || !next || !status) return null;

  const motion = windowRef.matchMedia?.('(prefers-reduced-motion: reduce)');
  const listeners = [];
  let current = 0;
  let playing = !motion?.matches;
  let timer = null;
  let destroyed = false;
  let pointerAction = null;

  function listen(target, type, handler) {
    target.addEventListener(type, handler);
    listeners.push(() => target.removeEventListener(type, handler));
  }

  function clearTimer() {
    if (timer !== null) windowRef.clearTimeout(timer);
    timer = null;
  }

  function schedule() {
    clearTimer();
    if (destroyed || !playing || documentRef.hidden || motion?.matches) return;
    timer = windowRef.setTimeout(() => {
      timer = null;
      show(current + 1);
    }, intervalMs);
  }

  function updateRotation() {
    rotation.disabled = Boolean(motion?.matches);
    rotation.textContent = motion?.matches ? '−' : playing ? 'Ⅱ' : '▶';
    rotation.title = motion?.matches ? 'Automatic slides are off: reduced motion is enabled' : playing ? 'Pause slides' : 'Play slides automatically';
    rotation.setAttribute('aria-label', motion?.matches
      ? 'Motion off: automatic slides are disabled because reduced motion is enabled'
      : playing ? 'Pause slides' : 'Play slides automatically');
    schedule();
  }

  function warmImage(index) {
    // Load only the imminent scene ahead of time; the remaining artwork stays lazy.
    const image = slides[index].querySelector('img');
    if (image) image.loading = 'eager';
  }

  function show(index, manual = false) {
    if (destroyed) return;
    current = (index + slides.length) % slides.length;
    if (manual) playing = false;
    warmImage(current);
    slides.forEach((slide, i) => { slide.hidden = i !== current; });
    // Automatic changes do not interrupt a screen reader. Manual selection is announced.
    if (manual) status.textContent = `${slides[current].dataset.slideName}, slide ${current + 1} of ${slides.length}.`;
    warmImage((current + 1) % slides.length);
    updateRotation();
  }

  listen(previous, 'click', () => show(current - 1, true));
  listen(next, 'click', () => show(current + 1, true));

  // A pointer press on Pause must still pause after its focus event stops rotation.
  listen(rotation, 'pointerdown', () => { pointerAction = !playing; });
  listen(rotation, 'pointercancel', () => { pointerAction = null; });
  listen(rotation, 'blur', () => { pointerAction = null; });
  listen(rotation, 'click', (event) => {
    if (motion?.matches) return;
    playing = event.detail > 0 && pointerAction !== null ? pointerAction : !playing;
    pointerAction = null;
    updateRotation();
  });
  listen(root, 'focusin', () => { playing = false; updateRotation(); });
  // Keep rotating when the mouse rests on the full-width artwork. Focus and the
  // explicit pause control remain available for people who need a still scene.
  listen(documentRef, 'visibilitychange', schedule);
  if (motion?.addEventListener) listen(motion, 'change', () => { playing = false; updateRotation(); });

  // Honour focus that arrived before this module finished loading.
  if (root.contains(documentRef.activeElement)) playing = false;
  controls.hidden = false;
  show(0);

  return { destroy() {
    destroyed = true;
    clearTimer();
    listeners.forEach((remove) => remove());
    controls.hidden = true;
    slides.forEach((slide, i) => { slide.hidden = i !== 0; });
  } };
}

if (typeof document !== 'undefined') {
  createHomepageCarousel(document.querySelector('[data-homepage-carousel]'));
}
