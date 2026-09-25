import { check, ApplicationError } from '../../shared/errors.mjs';

/** Cross-instance durable revision checks share one bounded poll per process.
 * Revisions contain no private payload. Router must revalidate authorization after wait.
 */
export function createRealtimeService({ repository, clock = Date.now, intervalMs = 1000,
  maxWaiters = 10_000, perAccount = 4, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const waiting = new Map(); let count = 0, timer = null, checking = false, closed = false;
  function finish(entry, value, error) {
    if (entry.done) return; entry.done = true;
    clearTimer(entry.timeout); entry.signal?.removeEventListener('abort', entry.abort);
    const entries = waiting.get(entry.userId); entries?.delete(entry);
    if (!entries?.size) waiting.delete(entry.userId);
    count--; if (!count) { clearTimer(timer); timer = null; }
    if (error) entry.reject(error); else entry.resolve(value);
  }
  function schedule() {
    if (timer || checking || !count || closed) return;
    timer = setTimer(() => { timer = null; void poll(); }, intervalMs);
    timer?.unref?.();
  }
  async function poll() {
    if (checking || !count || closed) return;
    checking = true;
    try {
      const ids = [...waiting.keys()], revisions = await repository.revisions(ids);
      for (const userId of ids) {
        const entries = waiting.get(userId); if (!entries) continue;
        const revision = revisions.get(userId) ?? '0';
        for (const entry of [...entries]) if (entry.cursor !== revision) finish(entry, { cursor: revision, changed: true });
      }
    } catch {
      for (const entries of waiting.values()) for (const entry of [...entries]) finish(entry, null,
        new ApplicationError('SERVER_DRAINING', 'Live updates are temporarily unavailable.'));
    } finally { checking = false; schedule(); }
  }
  async function wait(userId, { cursor = '0', waitMs = 25_000, signal } = {}) {
    check(!closed, 'SERVER_DRAINING', 'Live updates are restarting.');
    check(typeof userId === 'string' && userId, 'UNAUTHENTICATED', 'Sign in to continue.');
    check(/^(0|[1-9][0-9]{0,17})$/.test(cursor) && Number.isInteger(waitMs) && waitMs >= 0 && waitMs <= 25_000,
      'INVALID_CURSOR', 'Use valid update settings.');
    if (signal?.aborted) return { cursor, changed: false };
    check(count < maxWaiters && (waiting.get(userId)?.size ?? 0) < perAccount, 'RATE_LIMITED', 'Too many active update requests.');
    const latest = await repository.revision(userId);
    if (latest !== cursor || !waitMs || signal?.aborted) return { cursor: latest, changed: latest !== cursor };
    // Recheck after async read: simultaneous opens must obey the same cap.
    check(!closed && count < maxWaiters && (waiting.get(userId)?.size ?? 0) < perAccount, 'RATE_LIMITED', 'Too many active update requests.');
    return new Promise((resolve, reject) => {
      const entry = { userId, cursor, signal, resolve, reject, done: false, timeout: null, abort: null };
      entry.abort = () => finish(entry, { cursor, changed: false });
      entry.timeout = setTimer(() => finish(entry, { cursor, changed: false }), waitMs);
      const entries = waiting.get(userId) ?? new Set(); entries.add(entry); waiting.set(userId, entries); count++;
      signal?.addEventListener('abort', entry.abort, { once: true });
      if (signal?.aborted) { entry.abort(); return; }
      // The next shared check observes commits between the initial read and subscription.
      // Do not start another database scan for each new connection.
      schedule();
    });
  }
  return Object.freeze({ wait, publish: (ids) => repository.touch(ids, clock()),
    pending: () => count,
    close() { closed = true; clearTimer(timer); timer = null;
      for (const entries of waiting.values()) for (const entry of [...entries]) finish(entry, null,
        new ApplicationError('SERVER_DRAINING', 'Live updates are restarting.'));
    },
  });
}
