import { readDeliveryUpdate, readDeliveryUpdates, readDeliveryUpdateTarget } from '/shared/delivery-updates.mjs';

export const foodDeliveryTarget = (order) => order?.role === 'customer' && order.fulfillment === 'delivery'
  ? { kind: 'food', targetId: order.id } : null;
export const parcelDeliveryTarget = (user, ride) => user?.role === 'customer' && ride?.customer?.id === user.id && ride.delivery
  ? { kind: 'parcel', targetId: ride.id } : null;
export const deliveryUpdatePath = ({ screen, id }) => screen === 'food-order' ? `/eats?screen=order&id=${encodeURIComponent(id)}`
  : screen === 'parcels' ? `/parcels?id=${encodeURIComponent(id)}` : `/app?ride=${encodeURIComponent(id)}`;

/** Saved, authenticated milestones only. Polling never synthesizes arrival or an ETA. */
export function createDeliveryUpdates({ client, view, onOpen, identityOf = (session) => session.user ? `${session.user.id}:${session.csrfToken}` : null }) {
  let identity = null, target = null, update = null, alert = null, error = '', generation = 0, targetGeneration = 0;
  let pending = null, opening = false;
  const seen = new Set();
  const render = () => view.render({ identity, target, update, alert, error, opening });
  function context(nextIdentity, nextTarget = null) {
    const changed = identity !== nextIdentity;
    if (changed) { generation++; identity = nextIdentity; pending = null; opening = false; alert = null; seen.clear(); }
    if (changed || target?.kind !== nextTarget?.kind || target?.targetId !== nextTarget?.targetId) {
      targetGeneration++; target = nextIdentity ? nextTarget : null; update = null; error = '';
    }
    render();
  }
  async function sameAccount(epoch, key) {
    const session = await client.request('/api/session');
    if (generation !== epoch) return false;
    if (identityOf(session) !== key) { context(null); return false; }
    return true;
  }
  function poll() {
    if (!identity) return Promise.resolve();
    if (pending) return pending;
    const epoch = generation, selectedEpoch = targetGeneration, key = identity, selected = target;
    const task = (async () => {
      try {
        const [feedResult, detailResult] = await Promise.allSettled([
          client.request('/api/delivery-updates').then(readDeliveryUpdates),
          selected ? client.request(`/api/delivery-updates/${selected.kind}/${selected.targetId}`).then(value => readDeliveryUpdate(value, selected)) : null,
        ]);
        if (epoch !== generation || !await sameAccount(epoch, key)) return;
        error = '';
        if (feedResult.status === 'fulfilled') {
          const feed = feedResult.value, fresh = feed.updates.filter(item => item.readAt === null && !seen.has(item.id));
          for (const item of feed.updates) seen.add(item.id);
          // Replace a displayed snapshot when its road ETA finishes, and remove revoked/read notices.
          alert = fresh[0] ?? feed.updates.find(item => item.id === alert?.id && item.readAt === null) ?? null;
        } else {
          const failure = feedResult.reason;
          if ([401, 403].includes(failure.status) || failure.code === 'SESSION_CHANGED') { context(null); return; }
          alert = null;
          error = 'Kemmy delivery updates could not refresh. Your tracking and delivery controls remain available.';
        }
        if (selectedEpoch === targetGeneration) {
          if (detailResult.status === 'fulfilled') update = detailResult.value?.update ?? null;
          else {
            update = null;
            const failure = detailResult.reason;
            if (failure.status === 401 || failure.code === 'SESSION_CHANGED') { context(null); return; }
            if ([403, 404].includes(failure.status)) {
              if (alert?.kind === selected.kind && alert.targetId === selected.targetId) alert = null;
              error = 'This delivery update is no longer available. Refresh your deliveries to check access.';
            } else error = 'Kemmy delivery updates could not refresh. Your tracking and delivery controls remain available.';
          }
        }
        render();
      } catch (failure) {
        if (epoch !== generation) return;
        if ([401, 403].includes(failure.status) || failure.code === 'SESSION_CHANGED') { context(null); return; }
        error = 'Kemmy delivery updates could not refresh. Your tracking and delivery controls remain available.';
        render();
      }
    })();
    pending = task;
    void task.finally(() => { if (pending === task) pending = null; });
    return task;
  }
  async function open() {
    if (!identity || !alert || opening) return;
    const epoch = generation, key = identity, id = alert.id; opening = true; error = ''; render();
    try {
      if (!await sameAccount(epoch, key)) return;
      const response = readDeliveryUpdateTarget(await client.request(`/api/delivery-updates/${id}/open`, { method: 'POST', data: {} }));
      if (epoch !== generation || !await sameAccount(epoch, key)) return;
      alert = null; await onOpen(response.target);
    } catch (failure) {
      if (epoch !== generation) return;
      if (failure.status === 401 || failure.code === 'SESSION_CHANGED') { context(null); return; }
      if ([403, 404].includes(failure.status)) {
        if (update?.kind === alert?.kind && update?.targetId === alert?.targetId) update = null;
        alert = null;
      }
      error = failure.message || 'This delivery update could not be opened.';
    }
    finally { if (epoch === generation) { opening = false; render(); } }
  }
  return Object.freeze({ context, poll, open, dismiss() { alert = null; render(); }, reset() { context(null); }, snapshot: () => ({ identity, target, update, alert, error }) });
}
