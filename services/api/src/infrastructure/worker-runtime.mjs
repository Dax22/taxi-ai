/** Bounded regional jobs. HTTP instances with role=api never acquire a lease. */
export function createWorkerRuntime({ coordinator, config, regions, dispatch, maintenance = async () => {}, onError = () => {} }) {
  const running = new Map();
  let timer = null, ticking = null, stopped = config.role === 'api', maintenanceAt = 0;
  let queuedRegions = [];
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
    if (stopped || running.has(name) || running.size >= config.concurrency) return;
    const job = execute(name, task).catch(() => onError('worker_job_failed')).finally(() => running.delete(name));
    running.set(name, job);
  }
  async function tickInside() {
    if (stopped) return;
    if (!queuedRegions.length) {
      const list = config.regions ?? await regions();
      if (stopped) return;
      if (!Array.isArray(list) || list.length > 512) throw new Error('Worker region discovery exceeded its bound.');
      queuedRegions = [...list];
    }
    // Reserve a slot periodically before regional dispatch fills the pool.
    if (Date.now() >= maintenanceAt && !running.has('maintenance') && running.size < config.concurrency) {
      maintenanceAt = Date.now() + 5000;
      launch('maintenance', (lease, active) => active() ? maintenance({ lease, active }) : undefined);
    }
    // Consume the entire discovered page before fetching its successor. Rotating
    // an offset while also paging the database can permanently skip regions.
    while (queuedRegions.length && running.size < config.concurrency) {
      const region = queuedRegions.shift();
      launch(`dispatch:${region}`, (lease, active) => active() ? dispatch.refresh({ region, lease }) : undefined);
    }
  }
  function tick() {
    if (!ticking) ticking = tickInside().catch(() => onError('worker_tick_failed')).finally(() => { ticking = null; });
    return ticking;
  }
  return Object.freeze({
    tick,
    start() {
      if (stopped || timer) return;
      void tick(); timer = setInterval(() => { void tick(); }, config.intervalMs);
    },
    async stop() {
      stopped = true; clearInterval(timer); timer = null;
      let deadline;
      try {
        await Promise.race([(async () => { await ticking; await Promise.allSettled([...running.values()]); })(), new Promise((_, reject) => {
          deadline = setTimeout(() => reject(new Error('Worker shutdown deadline exceeded.')), config.shutdownMs);
        })]);
      } finally { clearTimeout(deadline); }
    },
    running: () => running.size,
  });
}
