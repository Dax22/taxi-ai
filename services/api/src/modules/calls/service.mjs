import { check } from '../../shared/errors.mjs';
import { fields } from '../../shared/validation.mjs';
import { requireRole } from '../../shared/policies.mjs';
import { canChatDuringRide } from '../../../../../packages/shared/src/trip-lifecycle.mjs';
import { isActiveCall } from '../../../../../packages/shared/src/call-lifecycle.mjs';
import { clientIdentity, commandData, version, audioDescription, RING_MS, CONNECT_MS, LEASE_MS, MAX_MS } from './domain.mjs';

export function createCallsService({ repository, getAccount, sessionOwner, getRideContext, unitOfWork, audit, tokens, clock, config }) {
  function actor(userId) {
    const user = getAccount(userId);
    check(user, 'UNAUTHENTICATED', 'Sign in to use calls.');
    requireRole(user, 'customer');
    return user;
  }
  function participant(user, id) {
    const call = repository.find(id);
    check(call && [call.callerId, call.calleeId].includes(user.id), 'NOT_FOUND', 'Call not found.');
    const ride = getRideContext(user, call.rideId);
    if (ride.driverId === user.id) requireRole(user, 'driver');
    return call;
  }
  function owns(call, userId, sessionHash, clientHash) {
    return call.callerId === userId ? call.callerSession === sessionHash && call.callerClient === clientHash
      : call.calleeId === userId && call.calleeSession === sessionHash && call.calleeClient === clientHash;
  }
  function view(call, context) {
    const peer = (id) => ({ id, name: getAccount(id).name });
    return { id: call.id, rideId: call.rideId, status: call.status, version: call.version,
      caller: peer(call.callerId), callee: peer(call.calleeId), createdAt: call.createdAt,
      answeredAt: call.answeredAt, connectedAt: call.connectedAt, endedAt: call.endedAt, endedBy: call.endedBy,
      reason: call.reason, ringExpiresAt: call.createdAt + RING_MS,
      owned: owns(call, context.userId, context.sessionHash, context.clientHash) };
  }
  function context(input, requireClient = false) {
    const user = actor(input.userId);
    check(typeof input.sessionToken === 'string', 'UNAUTHENTICATED', 'Sign in to use calls.');
    const sessionHash = tokens.digest(input.sessionToken);
    check(sessionOwner(sessionHash) === user.id, 'UNAUTHENTICATED', 'This call session has expired.');
    const clientHash = input.clientId ? tokens.digest(clientIdentity(input.clientId)) : null;
    check(!requireClient || clientHash, 'INVALID_CALL_CLIENT', 'Open the call controls in this window.');
    return { ...input, user, sessionHash, clientHash };
  }
  function close(call, status, reason, now, userId = null) {
    if (!isActiveCall(call)) return;
    repository.close(call.id, status, reason, userId, now);
    audit.record(userId ?? call.callerId, `call.${status}`, call.id, now);
  }
  // Called inside the rides transaction; do not start a nested transaction here.
  function closeRide(rideId, now) {
    for (const call of repository.active().filter((row) => row.rideId === rideId)) close(call, 'ended', 'ride_closed', now);
  }
  function expire() {
    const now = clock();
    for (const call of repository.active()) {
      const caller = getAccount(call.callerId), callee = getAccount(call.calleeId);
      const ride = getRideContext(caller, call.rideId);
      const driver = caller.id === ride.driverId ? caller : callee;
      if (!canChatDuringRide(ride.status)) close(call, 'ended', 'ride_closed', now);
      else if (config.mode !== call.mode || driver.driver?.status !== 'approved') close(call, 'ended', 'unavailable', now);
      else if (sessionOwner(call.callerSession) !== call.callerId
        || (call.calleeSession && sessionOwner(call.calleeSession) !== call.calleeId)) close(call, 'ended', 'session_ended', now);
      else if (call.status === 'ringing' && now >= call.createdAt + RING_MS) close(call, 'missed', 'no_answer', now);
      else if (call.status === 'connecting' && now >= call.answeredAt + CONNECT_MS) close(call, 'failed', 'connection_timeout', now);
      else if (now >= call.createdAt + MAX_MS) close(call, 'ended', 'max_duration', now);
      else if (now >= call.callerSeenAt + LEASE_MS || (call.calleeSeenAt !== null && now >= call.calleeSeenAt + LEASE_MS)) {
        close(call, 'failed', 'connection_lost', now);
      }
    }
  }
  const sweep = () => unitOfWork(expire);
  function list(input) {
    const ctx = context(input);
    sweep();
    const rows = repository.recent(ctx.userId);
    return { settings: config.describe(), active: rows.filter(isActiveCall).map((call) => view(call, ctx))[0] ?? null,
      recent: rows.filter((call) => !isActiveCall(call)).slice(0, 10).map((call) => view(call, ctx)) };
  }
  function media(input, id) {
    const ctx = context(input, true);
    sweep();
    const call = participant(ctx.user, id);
    check(isActiveCall(call) && call.status !== 'ringing', 'CALL_CLOSED', 'Answer the call before connecting audio.');
    check(owns(call, ctx.userId, ctx.sessionHash, ctx.clientHash), 'CALL_WINDOW', 'Audio belongs to the browser window that started or answered this call.');
    const sdp = ctx.userId === call.callerId ? call.answerSdp : call.offerSdp;
    return { call: view(call, ctx), configuration: config.rtc(call.id, ctx.userId, clock()),
      remoteDescription: sdp ? { type: ctx.userId === call.callerId ? 'answer' : 'offer', sdp } : null };
  }
  function mutate(input) {
    const ctx = context(input, true);
    const { action, key, id = null, rideId = null } = input;
    const data = commandData(action, input.data);
    check(typeof key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(key), 'INVALID_IDEMPOTENCY_KEY', 'A unique call command key is required.');
    const fingerprint = tokens.digest(JSON.stringify([action, id, rideId, ctx.clientHash, data]));
    // Deadline/session cleanup must persist even when the requested command is rejected.
    sweep();
    return unitOfWork(() => {
      const previous = repository.command(ctx.userId, key);
      if (previous) {
        check(previous.fingerprint === fingerprint, 'KEY_REUSED', 'This request key belongs to another call action.');
        return { call: view(participant(ctx.user, previous.callId), ctx), replayed: true };
      }
      const now = clock();
      let call;
      if (action === 'create') {
        check(config.mode !== 'off', 'CALL_UNAVAILABLE', 'Calling is disabled. You can still use chat.');
        const ride = getRideContext(ctx.user, rideId);
        check(ride.driverId && canChatDuringRide(ride.status), 'CALL_UNAVAILABLE', 'Calls open after a driver is assigned and close when the trip ends.');
        requireRole(getAccount(ride.driverId), 'driver');
        const calleeId = ctx.userId === ride.customerId ? ride.driverId : ride.customerId;
        check(!repository.busy(ctx.userId) && !repository.busy(calleeId), 'CALL_BUSY', 'One participant already has an active call.');
        check(repository.recentStarts(ctx.userId, now - 60_000) < 5, 'RATE_LIMITED', 'Wait before starting another call.');
        check(repository.countActive() < 200, 'CALL_UNAVAILABLE', 'The local preview has reached its call limit.');
        const callId = tokens.id();
        repository.insert({ id: callId, rideId, callerId: ctx.userId, calleeId, mode: config.mode, sessionHash: ctx.sessionHash, clientHash: ctx.clientHash, now });
        audit.record(ctx.userId, 'call.ringing', callId, now);
        call = repository.find(callId);
      } else {
        call = participant(ctx.user, id);
        if (action === 'end') {
          check(['hangup', 'media_failed', 'client_closed'].includes(data.reason), 'INVALID_CALL_REASON', 'Invalid call-ending reason.');
          close(call, data.reason === 'media_failed' ? 'failed' : 'ended', data.reason, now, ctx.userId);
        } else {
          check(isActiveCall(call), 'CALL_CLOSED', 'This call has ended. Start another call or use chat.');
          if (action === 'accept' || action === 'decline') {
            check(ctx.userId === call.calleeId, 'FORBIDDEN', 'Only the recipient can answer or decline.');
            version(call, data.expectedVersion);
            check(call.status === 'ringing', 'CALL_CLOSED', 'This call is no longer ringing.');
            if (action === 'decline') close(call, 'declined', 'declined', now, ctx.userId);
            else { repository.accept(id, ctx.sessionHash, ctx.clientHash, now); audit.record(ctx.userId, 'call.accepted', id, now); }
          } else if (action === 'signal') {
            check(call.status !== 'ringing', 'CALL_CLOSED', 'Wait for the recipient to answer.');
            check(owns(call, ctx.userId, ctx.sessionHash, ctx.clientHash), 'CALL_WINDOW', 'This call belongs to another browser window.');
            check(data.type === (ctx.userId === call.callerId ? 'offer' : 'answer'), 'INVALID_CALL_SIGNAL', 'Wrong audio negotiation role.');
            const sdp = audioDescription(data.type, data.sdp, config.mode);
            check(data.type !== 'answer' || call.offerSdp, 'INVALID_CALL_SIGNAL', 'Wait for the caller’s connection offer.');
            const saved = data.type === 'offer' ? call.offerSdp : call.answerSdp;
            check(!saved || saved === sdp, 'CALL_SIGNAL_EXISTS', 'Audio details cannot be replaced in this call. Start a new call to reconnect.');
            if (!saved) repository.signal(id, data.type, sdp);
          }
        }
        call = repository.find(id);
      }
      repository.saveCommand(ctx.userId, key, fingerprint, call.id);
      return { call: view(call, ctx), replayed: false };
    });
  }
  function pulse(input, id, data) {
    fields(data, ['connected']);
    check(typeof data.connected === 'boolean', 'INVALID_CALL_SIGNAL', 'Send the browser connection state.');
    const ctx = context(input, true);
    sweep();
    return unitOfWork(() => {
      const call = participant(ctx.user, id);
      check(isActiveCall(call), 'CALL_CLOSED', 'This call has ended.');
      check(owns(call, ctx.userId, ctx.sessionHash, ctx.clientHash), 'CALL_WINDOW', 'This call belongs to another browser window.');
      const now = clock();
      if (repository.pulse(id, ctx.userId === call.callerId, data.connected, now)) audit.record(ctx.userId, 'call.connected', id, now);
      return { call: view(repository.find(id), ctx) };
    });
  }
  return Object.freeze({ list, media, mutate, pulse, sweep, closeRide });
}
