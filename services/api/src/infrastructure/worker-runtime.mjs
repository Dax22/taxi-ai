import { dispatchHintRegions } from './dispatch-wakeups.mjs';

/** Bounded regional jobs. HTTP instances with role=api never acquire a lease. */
export function createWorkerRuntime({ coordinator, config, regions, dispatch, maintenance = async () => {}, wakeups, onError = () => {} }) {
  const running = new Map(), hints = new Set(), readyHints = new Set(), lastLaunch = new Map();
  const fast = config.matchingFast;
  const enabled = Boolean(fast?.enabled && wakeups?.subscribeDispatchWakeups && wakeups?.activeDispatchRegions);
  const allowed = (region) => (!config.regions || config.regions.includes(region)) && fast?.includesRegion(region);
  let timer = null, hintTimer = null, ticking = null, stopped = config.role === 'api', maintenanceAt = 0;
  let queuedRegions = [], scanRequested = false, tickAgain = false, subscription = null;
  function scheduleHints() {
    if (stopped || hintTimer || !enabled) return;
    let delay = hints.size ? 50 : Infinity;
    for (const region of readyHints) if (!running.has(`dispatch:${region}`))
      delay = Math.min(delay, Math.max(50, (lastLaunch.get(region) ?? 0) + 250 - Date.now()));
    if (!Number.isFinite(delay) || running.size >= config.concurrency) return;
    hintTimer = setTimeout(() => { hintTimer = null; void requestTick(false); }, delay);
    hintTimer.unref?.();
  }
  function onHint(hint) {
    if (stopped || !enabled) return;
    for (const region of dispatchHintRegions(hint)) if (allowed(region) && hints.size < 512) hints.add(region);
    scheduleHints();
  }
  async function execute(name, task) {
    const lease = await coordinator.acquire(name);
    if (!lease || stopped) { if (lease) await coordinator.release(lease); return; }
    let lost = false, renewing = false;
    const renewal = setInterval(() => {
      if (renewing || lost) return;
      renewing = true;
      Promise.resolve(coordinator.renew(lease)).then((ok) => { if (!ok) lost = true; })
        .catch(() => { lost = true; onError('worker_lease_renewal_failed'); }).finally(() => { renewing = false; });
    }, Math.max(1000, Math.floor(config.leaseMs / 3)));
    renewal.unref?.();
    try { await task(lease, () => !lost && !stopped); }
    finally { clearInterval(renewal); await coordinator.release(lease); }
  }
  function launch(name, task) {
    if (stopped || running.has(name) || running.size >= config.concurrency) return false;
    const job = execute(name, task).catch(() => onError('worker_job_failed')).finally(() => {
      running.delete(name); scheduleHints();
    });
    running.set(name, job);
    return true;
  }
  function launchRegion(region) {
    if (!launch(`dispatch:${region}`, (lease, active) => active() ? dispatch.refresh({ region, lease }) : undefined)) return false;
    if (enabled) {
      lastLaunch.delete(region); lastLaunch.set(region, Date.now());
      if (lastLaunch.size > 512) lastLaunch.delete(lastLaunch.keys().next().value);
    }
    return true;
  }
  async function tickInside() {
    if (stopped) return;
    const scan = scanRequested; scanRequested = false;
    if (scan && !queuedRegions.length) {
      const list = config.regions ?? await regions();
      if (stopped) return;
      if (!Array.isArray(list) || list.length > 512) throw new Error('Worker region discovery exceeded its bound.');
      queuedRegions = [...list];
    }
    if (enabled && hints.size) {
      const batch = [...hints]; hints.clear();
      try {
        // One bounded indexed read filters out empty neighboring cells. An
        // unavailable database loses only a hint: the normal scan still recovers.
        const active = await wakeups.activeDispatchRegions(batch);
        if (!Array.isArray(active) || active.length > 512) throw new Error('Worker wakeup lookup exceeded its bound.');
        for (const region of active) if (allowed(region) && readyHints.size < 512) readyHints.add(region);
      } catch { onError('worker_wakeup_lookup_failed'); }
      if (stopped) return;
    }
    // Reserve a slot periodically before regional dispatch fills the pool.
    if (Date.now() >= maintenanceAt && !running.has('maintenance') && running.size < config.concurrency) {
      maintenanceAt = Date.now() + 5000;
      launch('maintenance', (lease, active) => active() ? maintenance({ lease, active }) : undefined);
    }
    // A recovery page always gets a slot ahead of wakeups, preserving progress
    // even if a busy region produces a continuous notification stream.
    if (queuedRegions.length && running.size < config.concurrency) launchRegion(queuedRegions.shift());
    for (const region of readyHints) {
      if (running.size >= config.concurrency) break;
      if (running.has(`dispatch:${region}`) || Date.now() < (lastLaunch.get(region) ?? 0) + 250) continue;
      readyHints.delete(region); // A lost lease is not requeued into a busy loop.
      launchRegion(region);
    }
    // Consume the entire discovered page before fetching its successor. Rotating
    // an offset while also paging the database can permanently skip regions.
    while (queuedRegions.length && running.size < config.concurrency) launchRegion(queuedRegions.shift());
  }
  function requestTick(scan) {
    if (stopped) return Promise.resolve();
    scanRequested ||= scan;
    if (ticking) { tickAgain = true; return ticking; }
    ticking = tickInside().catch(() => onError('worker_tick_failed')).finally(() => {
      ticking = null;
      if (tickAgain && !stopped) { tickAgain = false; void requestTick(false); }
      else scheduleHints();
    });
    return ticking;
  }
  return Object.freeze({
    tick: () => requestTick(true),
    start() {
      if (stopped || timer) return;
      void requestTick(true); timer = setInterval(() => { void requestTick(true); }, config.intervalMs);
      if (enabled) subscription = wakeups.subscribeDispatchWakeups({ onHint, onReconnect: () => { void requestTick(true); }, onError });
    },
    async stop() {
      stopped = true; clearInterval(timer); timer = null; clearTimeout(hintTimer); hintTimer = null;
      hints.clear(); readyHints.clear();
      let deadline;
      try {
        await Promise.race([(async () => {
          await subscription?.stop(); subscription = null;
          await ticking; await Promise.allSettled([...running.values()]);
        })(), new Promise((_, reject) => {
          deadline = setTimeout(() => reject(new Error('Worker shutdown deadline exceeded.')), config.shutdownMs);
        })]);
      } finally { clearTimeout(deadline); }
    },
    running: () => running.size,
  });
}
