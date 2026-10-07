import { check } from '../../shared/errors.mjs';
import { fields, label } from '../../shared/validation.mjs';
import { DELIVERY_REPORTS, DELIVERY_EVENT_LABELS, deliveryOperationState } from './domain.mjs';

/** Participant-scoped exception ledger. All writes, return closure and audit join one transaction. */
export function createDeliveryOperationsService({ repository, getAccount, getTrip, isVerifiedRecipient, closeReturn, unitOfWork, tokens, audit, clock }) {
  async function access(userId, rideId) {
    check(typeof rideId === 'string' && /^[a-f0-9-]{36}$/.test(rideId), 'NOT_FOUND', 'Parcel not found.');
    const user = await getAccount(userId), ride = await getTrip(rideId);
    check(user, 'UNAUTHENTICATED', 'Sign in to continue.');
    check(ride?.delivery, 'NOT_FOUND', 'Parcel not found.');
    const role = ride.customerId === userId ? 'sender' : ride.driverId === userId ? 'courier'
      : await isVerifiedRecipient(userId, rideId) ? 'recipient' : null;
    check(role, 'NOT_FOUND', 'Parcel not found.');
    return { user, ride, role };
  }
  async function view(ctx) {
    const { ride, role } = ctx, events = await repository.events(ride.id);
    const state = deliveryOperationState(events, ride.status), latest = events.at(-1);
    const record = await repository.evidence(ride.id), position = record?.positionJson ? JSON.parse(record.positionJson) : null;
    const working = ride.status === 'in_progress' && !['returned', 'closed', 'delivered'].includes(state);
    return { rideId: ride.id, version: latest?.version ?? 0, state,
      events: events.map(event => ({ id: event.id, kind: event.kind, label: DELIVERY_EVENT_LABELS[event.kind],
        createdAt: event.createdAt, version: event.version, ...(role !== 'recipient' ? { note: event.note } : {}) })),
      evidence: record ? { reference: `PARCEL-${ride.id.slice(0, 8).toUpperCase()}`, verifiedAt: record.verifiedAt,
        method: record.method, locationRecorded: Boolean(record.positionRecorded),
        ...(role !== 'recipient' ? { position } : {}) } : null,
      can: { report: working && state === 'normal', requestReturn: working && role !== 'recipient' && ['normal', 'exception'].includes(state),
        authorizeReturn: working && role === 'sender' && state === 'return_requested',
        confirmReturn: working && role === 'sender' && state === 'return_authorized',
        resolve: working && role === 'sender' && ['exception', 'return_requested'].includes(state) } };
  }
  const get = (userId, rideId) => unitOfWork(async () => ({ operations: await view(await access(userId, rideId)) }));
  async function requireHandover(rideId) {
    const events = await repository.events(rideId);
    check(deliveryOperationState(events, 'in_progress') === 'normal', 'INVALID_TRIP_STATE',
      'This parcel has an unresolved delivery issue or return. The sender must resolve it before handover.');
  }
  async function command({ userId, rideId, data, key }) {
    fields(data, ['action', 'expectedVersion', 'note', 'reason', 'confirmation'], ['action', 'expectedVersion']);
    check(typeof key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(key), 'INVALID_IDEMPOTENCY_KEY', 'Use a unique command key.');
    check(Number.isSafeInteger(data.expectedVersion) && data.expectedVersion >= 0, 'INVALID_VERSION', 'Refresh the delivery record.');
    const note = data.note === undefined || data.note === '' ? '' : label(data.note, 'Delivery note', 3, 500);
    const fingerprint = tokens.digest(JSON.stringify([rideId, data.action, data.expectedVersion, note, data.reason ?? null, data.confirmation ?? null]));
    return unitOfWork(async () => {
      const ctx = await access(userId, rideId), previous = await repository.command(userId, key);
      if (previous) {
        check(previous.rideId === rideId && previous.fingerprint === fingerprint, 'KEY_REUSED', 'This command key belongs to another delivery action.');
        return { operations: await view(ctx), replayed: true };
      }
      const current = await view(ctx);
      check(current.version === data.expectedVersion, 'STALE_VERSION', 'Delivery progress changed. Refresh before trying again.');
      check(current.events.length < 100, 'LINK_LIMIT', 'This delivery needs staff assistance; its event limit has been reached.');
      const permission = ({ report: 'report', request_return: 'requestReturn', authorize_return: 'authorizeReturn',
        confirm_return: 'confirmReturn', resolve: 'resolve' })[data.action];
      check(permission && current.can[permission], 'INVALID_TRIP_STATE', 'This action is unavailable to this account at the current delivery stage.');
      let kind;
      if (data.action === 'report') {
        check(DELIVERY_REPORTS.includes(data.reason), 'INVALID_INPUT', 'Choose a delivery issue.'); kind = data.reason;
      } else {
        check(data.reason === undefined, 'INVALID_FIELDS', 'A reason is used only for a delivery issue report.');
        kind = ({ request_return: 'return_requested', authorize_return: 'return_authorized', confirm_return: 'return_received', resolve: 'resolved' })[data.action];
      }
      if (data.action === 'confirm_return') {
        check(data.confirmation === 'RECEIVED', 'INVALID_CONFIRMATION', 'Confirm only after physically receiving the returned parcel.');
        await closeReturn(ctx.user, rideId, ctx.ride.version, clock());
      } else check(data.confirmation === undefined, 'INVALID_FIELDS', 'Receipt confirmation is used only for a returned parcel.');
      if (['authorize_return', 'resolve'].includes(data.action)) check(note.length >= 3, 'INVALID_INPUT', 'Record the agreed instruction or resolution.');
      const now = clock();
      await repository.append({ id: tokens.id(), rideId, actorId: userId, kind, note, createdAt: now,
        version: current.version + 1, commandKey: key, fingerprint });
      await audit.record(userId, `delivery.operation.${kind}`, rideId, now);
      return { operations: await view(await access(userId, rideId)), replayed: false };
    });
  }
  return Object.freeze({ get, command, requireHandover });
}
