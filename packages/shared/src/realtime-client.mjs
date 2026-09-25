/** Account-scoped invalidations. One outstanding request; no trip/location payloads. */
export function createRealtimeClient({ read, refresh, onError = () => {}, fallbackMs = 30_000,
  setTimer = setTimeout, clearTimer = clearTimeout, random = Math.random }) {
  let active = false, epoch = 0, cursor = '0', controller = null, timer = null, fallback = null;
  let failures = 0, refreshing = null, refreshAgain = false;
  function reload() {
    if (!active) return Promise.resolve();
    if (refreshing) { refreshAgain = true; return refreshing; }
    const current = epoch;
    const task = (async () => {
      do { refreshAgain = false; await refresh(); } while (active && current === epoch && refreshAgain);
    })();
    refreshing = task;
    return task.finally(() => { if (refreshing === task) refreshing = null; });
  }
  function scheduleFallback(current) {
    fallback = setTimer(async () => {
      if (!active || current !== epoch) return;
      try { await reload(); } catch (error) { onError(error); }
      if (active && current === epoch) scheduleFallback(current);
    }, fallbackMs);
  }
  async function receive(current) {
    if (!active || current !== epoch) return;
    controller = new AbortController();
    let delay = 0;
    try {
      const result = await read(cursor, controller.signal);
      if (!active || current !== epoch) return;
      if (!result || !/^(0|[1-9][0-9]{0,17})$/.test(result.cursor) || typeof result.changed !== 'boolean') {
        throw new Error('Invalid update response.');
      }
      if (result.changed) await reload();
      if (!active || current !== epoch) return;
      cursor = result.cursor; failures = 0;
      // Rate limit even a malfunctioning server returning immediately without changes.
      delay = result.changed ? 100 : 250;
    } catch (error) {
      if (!active || current !== epoch) return;
      onError(error);
      delay = Math.min(30_000, 1000 * 2 ** Math.min(failures++, 5)) + Math.floor(random() * 500);
    }
    if (active && current === epoch) timer = setTimer(() => void receive(current), delay);
  }
  function pause() {
    active = false; epoch++; controller?.abort(); controller = null;
    clearTimer(timer); clearTimer(fallback); timer = fallback = null; refreshAgain = false; refreshing = null;
  }
  return Object.freeze({
    resume() { if (active) return; active = true; const current = ++epoch; scheduleFallback(current); void receive(current); },
    pause,
    reset() { pause(); cursor = '0'; failures = 0; },
    refresh: reload,
  });
}
