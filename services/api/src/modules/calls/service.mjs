import { check } from '../../shared/errors.mjs';
import { fields } from '../../shared/validation.mjs';
import { requireRole } from '../../shared/policies.mjs';
import { canChatDuringRide } from '../../../../../packages/shared/src/trip-lifecycle.mjs';
import { isActiveCall } from '../../../../../packages/shared/src/call-lifecycle.mjs';
import { clientIdentity, commandData, version, audioDescription, RING_MS, CONNECT_MS, LEASE_MS, MAX_MS } from './domain.mjs';
import { asyncMap } from '../../shared/async-collections.mjs';


export function createCallsService({ repository, getAccount, sessionOwner, getRideContext, unitOfWork, audit, tokens, clock, config }) {
  async function actor(userId) {
    const user = (await getAccount(userId));
    check(user, 'UNAUTHENTICATED', 'Sign in to use calls.');
    requireRole(user, 'customer');
    return user;
  }
  async function participant(user, id) {
    const call = (await repository.find(id));
    check(call && [call.callerId, call.calleeId].includes(user.id), 'NOT_FOUND', 'Call not found.');
    const ride = (await getRideContext(user, call.rideId));
    if (ride.driverId === user.id) requireRole(user, 'driver');
    return call;
  }
  function owns(call, userId, sessionHash, clientHash) {
    return call.callerId === userId ? call.callerSession === sessionHash && call.callerClient === clientHash
      : call.calleeId === userId && call.calleeSession === sessionHash && call.calleeClient === clientHash;
  }
  async function view(call, context) {
    const peer = async (id) => ({ id, name: (await getAccount(id)).name });
    return { id: call.id, rideId: call.rideId, status: call.status, version: call.version,
      caller: (await peer(call.callerId)), callee: (await peer(call.calleeId)), createdAt: call.createdAt,
      answeredAt: call.answeredAt, connectedAt: call.connectedAt, endedAt: call.endedAt, endedBy: call.endedBy,
      reason: call.reason, ringExpiresAt: call.createdAt + RING_MS,
      owned: owns(call, context.userId, context.sessionHash, context.clientHash) };
  }
  async function context(input, requireClient = false) {
    const user = (await actor(input.userId));
    let sessionHash;
    if (input.nativeSessionId !== undefined) {
      check(typeof input.nativeSessionId === 'string' && /^[a-f0-9-]{36}$/.test(input.nativeSessionId), 'UNAUTHENTICATED', 'This device session has expired.');
      sessionHash = `native:${input.nativeSessionId}`;
    } else {
      check(typeof input.sessionToken === 'string', 'UNAUTHENTICATED', 'Sign in to use calls.');
      sessionHash = tokens.digest(input.sessionToken);
    }
    check((await sessionOwner(sessionHash)) === user.id, 'UNAUTHENTICATED', 'This call session has expired.');
    const clientHash = input.clientId ? tokens.digest(clientIdentity(input.clientId)) : null;
    check(!requireClient || clientHash, 'INVALID_CALL_CLIENT', 'Open the call controls in this app session.');
    return { ...input, user, sessionHash, clientHash };
  }
  async function close(call, status, reason, now, userId = null) {
    if (!isActiveCall(call)) return;
    (await repository.close(call.id, status, reason, userId, now));
    (await audit.record(userId ?? call.callerId, `call.${status}`, call.id, now));
  }
  // Called inside the rides transaction; do not start a nested transaction here.
  async function closeRide(rideId, now) {
    for (const call of (await repository.active()).filter((row) => row.rideId === rideId)) (await close(call, 'ended', 'ride_closed', now));
  }
  async function expire() {
    const now = clock();
    for (const call of (await repository.active())) {
      const caller = (await getAccount(call.callerId)), callee = (await getAccount(call.calleeId));
      const ride = (await getRideContext(caller, call.rideId));
      const driver = caller.id === ride.driverId ? caller : callee;
      if (!canChatDuringRide(ride.status)) (await close(call, 'ended', 'ride_closed', now));
      else if (config.mode !== call.mode || driver.driver?.status !== 'approved') (await close(call, 'ended', 'unavailable', now));
      else if ((await sessionOwner(call.callerSession)) !== call.callerId
        || (call.calleeSession && (await sessionOwner(call.calleeSession)) !== call.calleeId)) (await close(call, 'ended', 'session_ended', now));
      else if (call.status === 'ringing' && now >= call.createdAt + RING_MS) (await close(call, 'missed', 'no_answer', now));
      else if (call.status === 'connecting' && now >= call.answeredAt + CONNECT_MS) (await close(call, 'failed', 'connection_timeout', now));
      else if (now >= call.createdAt + MAX_MS) (await close(call, 'ended', 'max_duration', now));
      else if (now >= call.callerSeenAt + LEASE_MS || (call.calleeSeenAt !== null && now >= call.calleeSeenAt + LEASE_MS)) {
        (await close(call, 'failed', 'connection_lost', now));
      }
    }
  }
  const sweep = async () => (await unitOfWork(expire));
  async function list(input) {
    const ctx = (await context(input));
    (await sweep());
    const rows = (await repository.recent(ctx.userId));
    return { settings: config.describe(), active: (await asyncMap(rows.filter(isActiveCall), async (call) => (await view(call, ctx))))[0] ?? null,
      recent: (await asyncMap(rows.filter((call) => !isActiveCall(call)).slice(0, 10), async (call) => (await view(call, ctx)))) };
  }
  async function media(input, id) {
    const ctx = (await context(input, true));
    (await sweep());
    const call = (await participant(ctx.user, id));
    check(isActiveCall(call) && call.status !== 'ringing', 'CALL_CLOSED', 'Answer the call before connecting audio.');
    check(owns(call, ctx.userId, ctx.sessionHash, ctx.clientHash), 'CALL_WINDOW', 'Audio belongs to the app or browser session that started or answered this call.');
    const sdp = ctx.userId === call.callerId ? call.answerSdp : call.offerSdp;
    return { call: (await view(call, ctx)), configuration: config.rtc(call.id, ctx.userId, clock()),
      remoteDescription: sdp ? { type: ctx.userId === call.callerId ? 'answer' : 'offer', sdp } : null };
  }
  async function mutate(input) {
    const ctx = (await context(input, true));
    const { action, key, id = null, rideId = null } = input;
    const data = commandData(action, input.data);
    check(typeof key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(key), 'INVALID_IDEMPOTENCY_KEY', 'A unique call command key is required.');
    const fingerprint = tokens.digest(JSON.stringify([action, id, rideId, ctx.clientHash, data]));
    // Deadline/session cleanup must persist even when the requested command is rejected.
    (await sweep());
    return (await unitOfWork(async () => {
      const previous = (await repository.command(ctx.userId, key));
      if (previous) {
        check(previous.fingerprint === fingerprint, 'KEY_REUSED', 'This request key belongs to another call action.');
        return { call: (await view((await participant(ctx.user, previous.callId)), ctx)), replayed: true };
      }
      const now = clock();
      let call;
      if (action === 'create') {
        check(config.mode !== 'off', 'CALL_UNAVAILABLE', 'Calling is disabled. You can still use chat.');
        const ride = (await getRideContext(ctx.user, rideId));
        check(ride.driverId && canChatDuringRide(ride.status), 'CALL_UNAVAILABLE', 'Calls open after a driver is assigned and close when the trip ends.');
        requireRole((await getAccount(ride.driverId)), 'driver');
        const calleeId = ctx.userId === ride.customerId ? ride.driverId : ride.customerId;
        check(!(await repository.busy(ctx.userId)) && !(await repository.busy(calleeId)), 'CALL_BUSY', 'One participant already has an active call.');
        check((await repository.recentStarts(ctx.userId, now - 60_000)) < 5, 'RATE_LIMITED', 'Wait before starting another call.');
        check((await repository.countActive()) < 200, 'CALL_UNAVAILABLE', 'The local preview has reached its call limit.');
        const callId = tokens.id();
        (await repository.insert({ id: callId, rideId, callerId: ctx.userId, calleeId, mode: config.mode, sessionHash: ctx.sessionHash, clientHash: ctx.clientHash, now }));
        (await audit.record(ctx.userId, 'call.ringing', callId, now));
        call = (await repository.find(callId));
      } else {
        call = (await participant(ctx.user, id));
        if (action === 'end') {
          check(['hangup', 'media_failed', 'client_closed'].includes(data.reason), 'INVALID_CALL_REASON', 'Invalid call-ending reason.');
          (await close(call, data.reason === 'media_failed' ? 'failed' : 'ended', data.reason, now, ctx.userId));
        } else {
          check(isActiveCall(call), 'CALL_CLOSED', 'This call has ended. Start another call or use chat.');
          if (action === 'accept' || action === 'decline') {
            check(ctx.userId === call.calleeId, 'FORBIDDEN', 'Only the recipient can answer or decline.');
            version(call, data.expectedVersion);
            check(call.status === 'ringing', 'CALL_CLOSED', 'This call is no longer ringing.');
            if (action === 'decline') (await close(call, 'declined', 'declined', now, ctx.userId));
            else { (await repository.accept(id, ctx.sessionHash, ctx.clientHash, now)); (await audit.record(ctx.userId, 'call.accepted', id, now)); }
          } else if (action === 'signal') {
            check(call.status !== 'ringing', 'CALL_CLOSED', 'Wait for the recipient to answer.');
            check(owns(call, ctx.userId, ctx.sessionHash, ctx.clientHash), 'CALL_WINDOW', 'This call belongs to another app or browser session.');
            check(data.type === (ctx.userId === call.callerId ? 'offer' : 'answer'), 'INVALID_CALL_SIGNAL', 'Wrong audio negotiation role.');
            const sdp = audioDescription(data.type, data.sdp, config.mode);
            check(data.type !== 'answer' || call.offerSdp, 'INVALID_CALL_SIGNAL', 'Wait for the caller’s connection offer.');
            const saved = data.type === 'offer' ? call.offerSdp : call.answerSdp;
            check(!saved || saved === sdp, 'CALL_SIGNAL_EXISTS', 'Audio details cannot be replaced in this call. Start a new call to reconnect.');
            if (!saved) (await repository.signal(id, data.type, sdp));
          }
        }
        call = (await repository.find(id));
      }
      (await repository.saveCommand(ctx.userId, key, fingerprint, call.id));
      return { call: (await view(call, ctx)), replayed: false };
    }));
  }
  async function pulse(input, id, data) {
    fields(data, ['connected']);
    check(typeof data.connected === 'boolean', 'INVALID_CALL_SIGNAL', 'Send the current audio connection state.');
    const ctx = (await context(input, true));
    (await sweep());
    return (await unitOfWork(async () => {
      const call = (await participant(ctx.user, id));
      check(isActiveCall(call), 'CALL_CLOSED', 'This call has ended.');
      check(owns(call, ctx.userId, ctx.sessionHash, ctx.clientHash), 'CALL_WINDOW', 'This call belongs to another app or browser session.');
      const now = clock();
      if ((await repository.pulse(id, ctx.userId === call.callerId, data.connected, now))) (await audit.record(ctx.userId, 'call.connected', id, now));
      return { call: (await view((await repository.find(id)), ctx)) };
    }));
  }
  return Object.freeze({ list, media, mutate, pulse, sweep, closeRide });
}
