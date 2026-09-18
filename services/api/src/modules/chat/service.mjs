import { check } from '../../shared/errors.mjs';
import { fields } from '../../shared/validation.mjs';
import { requireRole } from '../../shared/policies.mjs';
import { messageBody, sequence, MESSAGE_LIMIT, PAGE_SIZE, REPORT_REASONS } from './domain.mjs';

/** Participant-scoped communication. Fare decisions remain in the rides service. */
export function createChatService({ repository, getAccount, getRideContext, listConversationIds, unitOfWork, audit, tokens, clock }) {
  function actor(userId) {
    const user = getAccount(userId);
    check(user, 'UNAUTHENTICATED', 'Sign in to continue.');
    return user;
  }

  function conversation(userId, rideId) {
    const user = actor(userId);
    const ride = getRideContext(user, rideId); // The rides port enforces participant access, including for administrators.
    if (user.role === 'driver') requireRole(user, 'driver');
    check(ride.driverId, 'CHAT_NOT_READY', 'Chat opens when a driver starts your negotiation.');
    return { user, ride };
  }

  function summaries(userId) {
    const user = actor(userId);
    if (user.role === 'driver' && user.driver.status !== 'approved') return [];
    return listConversationIds(user).map((rideId) => ({ rideId,
      unread: repository.unread(rideId, userId), lastSequence: repository.latest(rideId) }));
  }

  function thread(userId, rideId, after = 0) {
    const { ride } = conversation(userId, rideId);
    sequence(after);
    const lastSequence = repository.latest(rideId);
    check(after <= lastSequence, 'INVALID_CURSOR', 'This message sequence is ahead of the conversation.');
    const rows = repository.listMessages(rideId, after, PAGE_SIZE + 1);
    const messages = rows.slice(0, PAGE_SIZE);
    return { rideId, messages, hasMore: rows.length > PAGE_SIZE,
      nextAfter: messages.at(-1)?.sequence ?? after, lastSequence,
      readThrough: repository.readThrough(rideId, userId), unread: repository.unread(rideId, userId),
      reportedMessageIds: repository.reportedMessages(rideId, userId),
      canSend: ['negotiating', 'agreed'].includes(ride.status) && lastSequence < MESSAGE_LIMIT };
  }

  function send({ userId, rideId, key, data }) {
    fields(data, ['body']);
    const body = messageBody(data.body);
    check(typeof key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(key),
      'INVALID_IDEMPOTENCY_KEY', 'A unique message key is required.');
    const fingerprint = tokens.digest(JSON.stringify([rideId, body]));
    return unitOfWork(() => {
      const { ride } = conversation(userId, rideId);
      const previous = repository.findCommand(userId, key);
      if (previous) {
        check(previous.fingerprint === fingerprint, 'KEY_REUSED', 'This request key was already used for another message.');
        return { message: repository.findMessage(previous.messageId), replayed: true };
      }
      check(['negotiating', 'agreed'].includes(ride.status), 'CHAT_CLOSED', 'This request is closed. Its conversation is read-only.');
      const next = repository.latest(rideId) + 1;
      check(next <= MESSAGE_LIMIT, 'MESSAGE_LIMIT', 'This test conversation has reached its message limit.');
      const message = { id: tokens.id(), rideId, sequence: next, senderId: userId, body, createdAt: clock() };
      repository.insertMessage(message);
      audit.record(userId, 'chat.message_sent', message.id, message.createdAt);
      repository.saveCommand(userId, key, fingerprint, message.id);
      return { message, replayed: false };
    });
  }

  function markRead(userId, rideId, data) {
    fields(data, ['throughSequence']);
    const through = sequence(data.throughSequence);
    return unitOfWork(() => {
      conversation(userId, rideId);
      check(through <= repository.latest(rideId), 'INVALID_CURSOR', 'You cannot mark future messages as read.');
      repository.markRead(rideId, userId, through, clock());
      return { readThrough: repository.readThrough(rideId, userId), unread: repository.unread(rideId, userId) };
    });
  }

  function report(userId, rideId, messageId, data) {
    fields(data, ['reason']);
    check(REPORT_REASONS.includes(data.reason), 'INVALID_REPORT', 'Choose a reason for this report.');
    return unitOfWork(() => {
      conversation(userId, rideId);
      const message = repository.findMessage(messageId);
      check(message?.rideId === rideId, 'NOT_FOUND', 'Message not found.');
      check(message.senderId !== userId, 'INVALID_REPORT', 'You can report messages from the other participant.');
      const previous = repository.reportFor(messageId, userId);
      if (previous) return { report: previous, replayed: true };
      const report = { id: tokens.id(), messageId, reporterId: userId, reason: data.reason, createdAt: clock() };
      repository.insertReport(report);
      audit.record(userId, 'chat.message_reported', report.id, report.createdAt);
      return { report: repository.findReport(report.id), replayed: false };
    });
  }

  function reports(userId) {
    requireRole(actor(userId), 'admin');
    return repository.listReports().map((report) => {
      const message = repository.findMessage(report.messageId);
      return { ...report, message, reporterName: getAccount(report.reporterId).name,
        senderName: getAccount(message.senderId).name };
    });
  }

  function reviewReport(userId, id, data) {
    fields(data, []);
    return unitOfWork(() => {
      requireRole(actor(userId), 'admin');
      const report = repository.findReport(id);
      check(report, 'NOT_FOUND', 'Report not found.');
      if (report.status === 'open') {
        const now = clock();
        repository.reviewReport(id, userId, now);
        audit.record(userId, 'chat.report_reviewed', id, now);
      }
      return repository.findReport(id);
    });
  }

  return Object.freeze({ summaries, thread, send, markRead, report, reports, reviewReport });
}
