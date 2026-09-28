import { check } from '../../shared/errors.mjs';
import { fields } from '../../shared/validation.mjs';
import { requireRole } from '../../shared/policies.mjs';
import { messageBody, sequence, MESSAGE_LIMIT, PAGE_SIZE, REPORT_REASONS } from './domain.mjs';
import { canChatDuringRide } from '../../../../../packages/shared/src/trip-lifecycle.mjs';
import { asyncMap, asyncFilter } from '../../shared/async-collections.mjs';


/** Participant-scoped communication. Fare decisions remain in the rides service. */
export function createChatService({ repository, getAccount, getRideContext, listConversationIds, unitOfWork, audit, tokens, clock, onMessage = () => {} }) {
  async function actor(userId) {
    const user = (await getAccount(userId));
    check(user, 'UNAUTHENTICATED', 'Sign in to continue.');
    return user;
  }

  async function conversation(userId, rideId) {
    const user = (await actor(userId));
    const ride = (await getRideContext(user, rideId)); // The rides port enforces participant access, including for administrators.
    if (ride.driverId === user.id) requireRole(user, 'driver');
    check(ride.driverId, 'CHAT_NOT_READY', 'Chat opens when a driver starts your negotiation.');
    return { user, ride };
  }

  async function summaries(userId) {
    const user = (await actor(userId));
    return (await asyncMap((await asyncFilter((await listConversationIds(user)), async (id) => (await getRideContext(user, id)).driverId !== user.id || user.driver?.status === 'approved')), async (rideId) => ({ rideId,
      unread: (await repository.unread(rideId, userId)), lastSequence: (await repository.latest(rideId)) })));
  }

  async function thread(userId, rideId, after = 0) {
    const { ride } = (await conversation(userId, rideId));
    sequence(after);
    const lastSequence = (await repository.latest(rideId));
    check(after <= lastSequence, 'INVALID_CURSOR', 'This message sequence is ahead of the conversation.');
    const rows = (await repository.listMessages(rideId, after, PAGE_SIZE + 1));
    const messages = rows.slice(0, PAGE_SIZE);
    return { rideId, messages, hasMore: rows.length > PAGE_SIZE,
      nextAfter: messages.at(-1)?.sequence ?? after, lastSequence,
      readThrough: (await repository.readThrough(rideId, userId)), unread: (await repository.unread(rideId, userId)),
      reportedMessageIds: (await repository.reportedMessages(rideId, userId)),
      canSend: canChatDuringRide(ride.status) && lastSequence < MESSAGE_LIMIT };
  }

  async function send({ userId, rideId, key, data }) {
    fields(data, ['body']);
    const body = messageBody(data.body);
    check(typeof key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(key),
      'INVALID_IDEMPOTENCY_KEY', 'A unique message key is required.');
    const fingerprint = tokens.digest(JSON.stringify([rideId, body]));
    return (await unitOfWork(async () => {
      const { ride } = (await conversation(userId, rideId));
      const previous = (await repository.findCommand(userId, key));
      if (previous) {
        check(previous.fingerprint === fingerprint, 'KEY_REUSED', 'This request key was already used for another message.');
        return { message: (await repository.findMessage(previous.messageId)), replayed: true };
      }
      check(canChatDuringRide(ride.status), 'CHAT_CLOSED', 'This trip is closed. Its conversation is read-only.');
      const next = (await repository.latest(rideId)) + 1;
      check(next <= MESSAGE_LIMIT, 'MESSAGE_LIMIT', 'This test conversation has reached its message limit.');
      const message = { id: tokens.id(), rideId, sequence: next, senderId: userId, body, createdAt: clock() };
      (await repository.insertMessage(message));
      (await audit.record(userId, 'chat.message_sent', message.id, message.createdAt));
      (await repository.saveCommand(userId, key, fingerprint, message.id));
      (await onMessage({ ride, message }));
      return { message, replayed: false };
    }));
  }

  async function markRead(userId, rideId, data) {
    fields(data, ['throughSequence']);
    const through = sequence(data.throughSequence);
    return (await unitOfWork(async () => {
      (await conversation(userId, rideId));
      check(through <= (await repository.latest(rideId)), 'INVALID_CURSOR', 'You cannot mark future messages as read.');
      (await repository.markRead(rideId, userId, through, clock()));
      return { readThrough: (await repository.readThrough(rideId, userId)), unread: (await repository.unread(rideId, userId)) };
    }));
  }

  async function report(userId, rideId, messageId, data) {
    fields(data, ['reason']);
    check(REPORT_REASONS.includes(data.reason), 'INVALID_REPORT', 'Choose a reason for this report.');
    return (await unitOfWork(async () => {
      (await conversation(userId, rideId));
      const message = (await repository.findMessage(messageId));
      check(message?.rideId === rideId, 'NOT_FOUND', 'Message not found.');
      check(message.senderId !== userId, 'INVALID_REPORT', 'You can report messages from the other participant.');
      const previous = (await repository.reportFor(messageId, userId));
      if (previous) return { report: previous, replayed: true };
      const report = { id: tokens.id(), messageId, reporterId: userId, reason: data.reason, createdAt: clock() };
      (await repository.insertReport(report));
      (await audit.record(userId, 'chat.message_reported', report.id, report.createdAt));
      return { report: (await repository.findReport(report.id)), replayed: false };
    }));
  }

  async function reports(userId) {
    requireRole((await actor(userId)), 'admin');
    return (await asyncMap((await repository.listReports()), async (report) => {
      const message = (await repository.findMessage(report.messageId));
      return { ...report, message, reporterName: (await getAccount(report.reporterId)).name,
        senderName: (await getAccount(message.senderId)).name };
    }));
  }

  async function reviewReport(userId, id, data) {
    fields(data, []);
    return (await unitOfWork(async () => {
      requireRole((await actor(userId)), 'admin');
      const report = (await repository.findReport(id));
      check(report, 'NOT_FOUND', 'Report not found.');
      if (report.status === 'open') {
        const now = clock();
        (await repository.reviewReport(id, userId, now));
        (await audit.record(userId, 'chat.report_reviewed', id, now));
      }
      return (await repository.findReport(id));
    }));
  }

  return Object.freeze({ summaries, thread, send, markRead, report, reports, reviewReport });
}
