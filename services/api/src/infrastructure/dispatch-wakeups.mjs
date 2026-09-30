import { createHash } from 'node:crypto';

const REGION = /^(ng:\d{1,3}:\d{1,3}|sample:[a-z0-9-]{1,80})$/;
export const dispatchWakeupChannel = (schema) => `taxi_dispatch_${createHash('md5').update(schema).digest('hex')}`;
export function parseDispatchHint(payload) {
  if (typeof payload !== 'string' || payload.length > 160) return null;
  try {
    const hint = JSON.parse(payload);
    return hint && ['ride', 'availability'].includes(hint.type) && typeof hint.region === 'string' && REGION.test(hint.region)
      ? { type: hint.type, region: hint.region } : null;
  } catch { return null; }
}

/** Request cells, not drivers, own leases. Include neighboring request cells so
 * an available driver across a grid border can wake all eligible requests. */
export function dispatchHintRegions(hint) {
  if (!hint || !REGION.test(hint.region ?? '')) return [];
  if (hint.type !== 'availability' || !hint.region.startsWith('ng:')) return [hint.region];
  const [, lat, lng] = hint.region.split(':').map(Number), regions = [];
  // 0.05 degree cells, a maximum 10km radius, and Nigeria's latitude bounds:
  // three cells in either direction conservatively cover every eligible pickup.
  for (let y = Math.max(80, lat - 3); y <= Math.min(279, lat + 3); y++)
    for (let x = Math.max(40, lng - 3); x <= Math.min(299, lng + 3); x++) regions.push(`ng:${y}:${x}`);
  return regions;
}

/** A dedicated connection: LISTEN state must never leak into a pooled client.
 * Notifications are hints only. Startup/reconnect requests an ordinary scan,
 * and periodic worker scans remain the durable recovery mechanism. */
export function createDispatchWakeupSubscription({ createClient, schema, onHint, onReconnect = () => {}, onError = () => {}, retryMs = 1000 }) {
  const channel = dispatchWakeupChannel(schema);
  let stopped = false, client = null, connecting = null, retry = null, attempts = 0;
  const report = () => { try { onError('worker_wakeup_connection_failed'); } catch { /* Logging must not break recovery. */ } };
  function schedule() {
    if (stopped || retry) return;
    retry = setTimeout(() => { retry = null; connect(); }, Math.min(30000, retryMs * 2 ** Math.min(attempts++, 5)));
    retry.unref?.();
  }
  function connect() {
    if (stopped || client) return;
    if (connecting) { schedule(); return; }
    const current = createClient(); client = current;
    let failed = false;
    const disconnected = () => {
      if (failed) return;
      failed = true;
      if (client === current) client = null;
      void Promise.resolve(current.end()).catch(() => {});
      if (!stopped) { report(); schedule(); }
    };
    current.on('error', disconnected);
    current.on('end', disconnected);
    current.on('notification', (message) => {
      if (stopped || failed || message.channel !== channel) return;
      const hint = parseDispatchHint(message.payload);
      if (hint) { try { onHint(hint); } catch { report(); } }
    });
    connecting = (async () => {
      try {
        await current.connect();
        if (stopped || failed) return;
        await current.query(`LISTEN "${channel}"`);
        if (stopped || failed) return;
        attempts = 0;
        onReconnect();
      } catch { disconnected(); }
      finally {
        connecting = null;
        if (stopped || failed) { try { await current.end(); } catch { /* Already disconnected. */ } }
        if (failed && !stopped) schedule();
      }
    })();
  }
  connect();
  return Object.freeze({ async stop() {
    if (stopped) return;
    stopped = true; clearTimeout(retry); retry = null;
    const current = client; client = null;
    try { await current?.end(); } catch { /* Connection may already be gone. */ }
    await connecting;
  } });
}
