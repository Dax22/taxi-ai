import { check } from '../../shared/errors.mjs';
import { fields } from '../../shared/validation.mjs';
import { hasCapability } from '../../shared/policies.mjs';
import { NOTIFICATION_LABELS } from '../../../../../packages/shared/src/notification-labels.mjs';
import { arrivalNotice } from '../../../../../packages/shared/src/pickup-identity.mjs';
import { asyncMap } from '../../shared/async-collections.mjs';


export function createNotificationsService({ repository, getAccount, sessionOwner, canOpen, getArrival = () => null,
  shouldSendRequest = () => true, provider, unitOfWork, clock }) {
  let running = false, stopped = false;
  const actor = async (id) => { const user = (await getAccount(id)); check(hasCapability(user, 'customer'), 'FORBIDDEN', 'Sign in to view updates.'); return user; };
  const own = async (userId,id) => { (await actor(userId)); check(Number.isSafeInteger(id) && id > 0, 'INVALID_CURSOR', 'Invalid update ID.'); const n = (await repository.find(id)); check(n?.userId === userId, 'NOT_FOUND', 'Update not found.'); return n; };
  const arrival = async (n) => n?.kind === 'arrive' && n.mode === 'customer' ? (await getArrival(n.userId, n.rideId)) : null;
  const project = async (n) => {
    const { id, rideId, kind, mode, createdAt, readAt } = n, context = (await arrival(n)), notice = arrivalNotice(context?.driver);
    return { id, rideId, kind, mode, createdAt, readAt, title: NOTIFICATION_LABELS[kind],
      ...(notice ? { body: notice.body, arrivalActive: context.status === 'arrived' } : {}) };
  };
  // Internal event port. The caller's transaction includes both state changes and notification jobs.
  async function publish({ userId, rideId, kind, mode, eventKey, now = clock() }) {
    if (hasCapability((await getAccount(userId)), mode === 'work' ? 'driver' : 'customer')) (await repository.add({ userId,rideId,kind,mode,eventKey,now }));
  }
  async function list(userId,before = null,sessionId) {
    (await actor(userId));
    if (before !== null) { check(Number.isSafeInteger(before) && before > 0,'INVALID_CURSOR','Invalid updates cursor.'); (await own(userId,before)); }
    const rows = (await repository.list(userId,before ?? Number.MAX_SAFE_INTEGER)), page = rows.slice(0,50);
    return { notifications: (await asyncMap(page, project)), unread: (await repository.unread(userId)), nextBefore: rows.length > 50 ? page.at(-1).id : null,
      push: { enabled: provider.enabled, projectId: provider.projectId, registered: Boolean((await repository.registered(sessionId))) } };
  }
  async function open(userId,id) {
    const n = (await own(userId,id)); (await canOpen((await getAccount(userId)), n));
    (await unitOfWork(async () => (await repository.read(id,clock())))); return { target: { rideId: n.rideId, mode: n.mode, screen: n.kind === 'request' ? 'work' : 'journey' } };
  }
  async function read(userId,id) { (await own(userId,id)); (await unitOfWork(async () => (await repository.read(id,clock())))); return { read: true }; }
  async function register(userId,sessionId,data) {
    fields(data,['token','projectId']); (await actor(userId));
    check(provider.enabled && data.projectId === provider.projectId,'INVALID_PUSH_CONFIG','Push notifications are not configured for this build.');
    check(typeof data.token === 'string' && /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$/.test(data.token),'INVALID_PUSH_TOKEN','Invalid notification token.');
    check((await sessionOwner(sessionId)) === userId,'UNAUTHENTICATED','This device session ended.');
    (await unitOfWork(async () => (await repository.register(sessionId,userId,data.token)))); return { registered: true };
  }
  async function unregister(userId,sessionId,data) { fields(data,[]); (await actor(userId)); (await unitOfWork(async () => (await repository.unregister(sessionId)))); return { registered: false }; }
  async function deliverPending() {
    if (stopped || running || !provider.enabled) return;
    running = true;
    try {
      for (const job of (await repository.due(clock()))) {
        if (stopped) break;
        const valid = async () => (await repository.jobActive(job.id)) && (await sessionOwner(job.sessionId)) === job.userId && (await repository.registered(job.sessionId)) === job.token
          && ((await repository.find(job.notificationId))?.mode !== 'work' || hasCapability((await getAccount(job.userId)), 'driver'));
        // An invitation may end long before the generic push job TTL. Check the
        // current offer immediately before sending; an existing ticket only
        // polls a receipt and must not be turned into another notification.
        const requestActive = job.kind !== 'request' || job.status !== 'pending'
          || (await shouldSendRequest(job.userId, (await repository.find(job.notificationId))?.rideId));
        const arrived = job.kind === 'arrive' && job.status === 'pending' ? (await arrival((await repository.find(job.notificationId)))) : null;
        if (!(await valid()) || !requestActive || job.kind === 'arrive' && job.status === 'pending' && arrived?.status !== 'arrived'
          || clock() >= job.createdAt + (['request','arrive'].includes(job.kind) && job.status === 'pending' ? 300_000 : 86_400_000) || job.attempts >= 8) {
          (await unitOfWork(async () => (await repository.finish(job.id,'dead',clock(),null,job.attempts)))); continue;
        }
        if (!await unitOfWork(() => repository.lease(job.id,clock(),job.attempts))) continue;
        const claimedAttempt = job.attempts + 1;
        let result;
        try { result = job.status === 'ticket' ? await provider.receipt(job.ticket) : await provider.send({ token: job.token, notificationId: job.notificationId,
          ...(arrived ? { arrivalBody: arrivalNotice(arrived.driver)?.body } : {}) }); }
        catch { result = { status: 'retry' }; }
        if (stopped) break;
        (await unitOfWork(async () => {
          if (!await repository.ownsLease(job.id,claimedAttempt)) return;
          if (!(await valid())) { (await repository.finish(job.id,'dead',clock(),null,claimedAttempt)); return; }
          if (result.status === 'unregistered') (await repository.disable(job.token));
          const status = result.status === 'ok' ? 'done' : result.status === 'ticket' ? 'ticket'
            : ['unregistered','error'].includes(result.status) ? 'dead' : job.status;
          (await repository.finish(job.id,status,clock() + (status === 'ticket' ? 15 * 60_000 : Math.min(60_000 * 2 ** job.attempts,3600_000)), result.ticket ?? job.ticket, claimedAttempt));
        }));
      }
    } finally { running = false; }
  }
  return Object.freeze({ publish, list, open, read, register, unregister, deliverPending,
    onProfileDeleted: async (id, now) => (await repository.closeWork(id, now)), stop: () => { stopped = true; } });
}
