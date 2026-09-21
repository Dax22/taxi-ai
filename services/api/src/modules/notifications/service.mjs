import { check } from '../../shared/errors.mjs';
import { fields } from '../../shared/validation.mjs';
import { hasCapability } from '../../shared/policies.mjs';
import { NOTIFICATION_LABELS } from '../../../../../packages/shared/src/notification-labels.mjs';
import { arrivalNotice } from '../../../../../packages/shared/src/pickup-identity.mjs';

export function createNotificationsService({ repository, getAccount, sessionOwner, canOpen, getArrival = () => null, provider, unitOfWork, clock }) {
  let running = false, stopped = false;
  const actor = (id) => { const user = getAccount(id); check(hasCapability(user, 'customer'), 'FORBIDDEN', 'Sign in to view updates.'); return user; };
  const own = (userId,id) => { actor(userId); check(Number.isSafeInteger(id) && id > 0, 'INVALID_CURSOR', 'Invalid update ID.'); const n = repository.find(id); check(n?.userId === userId, 'NOT_FOUND', 'Update not found.'); return n; };
  const arrival = (n) => n?.kind === 'arrive' && n.mode === 'customer' ? getArrival(n.userId, n.rideId) : null;
  const project = (n) => {
    const { id, rideId, kind, mode, createdAt, readAt } = n, context = arrival(n), notice = arrivalNotice(context?.driver);
    return { id, rideId, kind, mode, createdAt, readAt, title: NOTIFICATION_LABELS[kind],
      ...(notice ? { body: notice.body, arrivalActive: context.status === 'arrived' } : {}) };
  };
  // Internal event port. The caller's transaction includes both state changes and notification jobs.
  function publish({ userId, rideId, kind, mode, eventKey, now = clock() }) {
    if (hasCapability(getAccount(userId), mode === 'work' ? 'driver' : 'customer')) repository.add({ userId,rideId,kind,mode,eventKey,now });
  }
  function list(userId,before = null,sessionId) {
    actor(userId);
    if (before !== null) { check(Number.isSafeInteger(before) && before > 0,'INVALID_CURSOR','Invalid updates cursor.'); own(userId,before); }
    const rows = repository.list(userId,before ?? Number.MAX_SAFE_INTEGER), page = rows.slice(0,50);
    return { notifications: page.map(project), unread: repository.unread(userId), nextBefore: rows.length > 50 ? page.at(-1).id : null,
      push: { enabled: provider.enabled, projectId: provider.projectId, registered: Boolean(repository.registered(sessionId)) } };
  }
  function open(userId,id) {
    const n = own(userId,id); canOpen(getAccount(userId), n);
    unitOfWork(() => repository.read(id,clock())); return { target: { rideId: n.rideId, mode: n.mode, screen: n.kind === 'request' ? 'work' : 'journey' } };
  }
  function read(userId,id) { own(userId,id); unitOfWork(() => repository.read(id,clock())); return { read: true }; }
  function register(userId,sessionId,data) {
    fields(data,['token','projectId']); actor(userId);
    check(provider.enabled && data.projectId === provider.projectId,'INVALID_PUSH_CONFIG','Push notifications are not configured for this build.');
    check(typeof data.token === 'string' && /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$/.test(data.token),'INVALID_PUSH_TOKEN','Invalid notification token.');
    check(sessionOwner(sessionId) === userId,'UNAUTHENTICATED','This device session ended.');
    unitOfWork(() => repository.register(sessionId,userId,data.token)); return { registered: true };
  }
  function unregister(userId,sessionId,data) { fields(data,[]); actor(userId); unitOfWork(() => repository.unregister(sessionId)); return { registered: false }; }
  async function deliverPending() {
    if (stopped || running || !provider.enabled) return;
    running = true;
    try {
      for (const job of repository.due(clock())) {
        if (stopped) break;
        const valid = () => sessionOwner(job.sessionId) === job.userId && repository.registered(job.sessionId) === job.token;
        const arrived = job.kind === 'arrive' && job.status === 'pending' ? arrival(repository.find(job.notificationId)) : null;
        if (!valid() || job.kind === 'arrive' && job.status === 'pending' && arrived?.status !== 'arrived'
          || clock() >= job.createdAt + (['request','arrive'].includes(job.kind) && job.status === 'pending' ? 300_000 : 86_400_000) || job.attempts >= 8) {
          unitOfWork(() => repository.finish(job.id,'dead',clock())); continue;
        }
        unitOfWork(() => repository.lease(job.id,clock()));
        let result;
        try { result = job.status === 'ticket' ? await provider.receipt(job.ticket) : await provider.send({ token: job.token, notificationId: job.notificationId,
          ...(arrived ? { arrivalBody: arrivalNotice(arrived.driver)?.body } : {}) }); }
        catch { result = { status: 'retry' }; }
        if (stopped) break;
        unitOfWork(() => {
          if (!valid()) { repository.finish(job.id,'dead',clock()); return; }
          if (result.status === 'unregistered') repository.disable(job.token);
          const status = result.status === 'ok' ? 'done' : result.status === 'ticket' ? 'ticket'
            : ['unregistered','error'].includes(result.status) ? 'dead' : job.status;
          repository.finish(job.id,status,clock() + (status === 'ticket' ? 15 * 60_000 : Math.min(60_000 * 2 ** job.attempts,3600_000)), result.ticket ?? job.ticket);
        });
      }
    } finally { running = false; }
  }
  return Object.freeze({ publish, list, open, read, register, unregister, deliverPending, stop: () => { stopped = true; } });
}
