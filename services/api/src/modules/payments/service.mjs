import { check } from '../../shared/errors.mjs';
import { fields } from '../../shared/validation.mjs';
import { requireRole } from '../../shared/policies.mjs';
import { requirePaymentVersion, verifySimulation, summarizePayments } from './domain.mjs';

export function createPaymentsService({ repository, getAccount, tripForPayment, simulate, unitOfWork, tokens, audit, clock, allowSimulation = false }) {
  const settings = Object.freeze({ mode: 'simulation', canSimulate: allowSimulation });
  function actor(id) {
    const user = getAccount(id);
    check(user, 'UNAUTHENTICATED', 'Sign in to continue.');
    return user;
  }
  function owned(user, id) {
    const payment = repository.find(id);
    check(payment && [payment.customerId, payment.driverId].includes(user.id), 'NOT_FOUND', 'Payment not found.');
    return payment;
  }
  function view(payment) {
    const { customerId, driverId, currentAttemptId, ...publicFields } = payment;
    const attempt = currentAttemptId ? repository.findAttempt(currentAttemptId) : null;
    return { ...publicFields, attempt: attempt ? { id: attempt.id, reference: attempt.reference, status: attempt.status,
      createdAt: attempt.createdAt, resolvedAt: attempt.resolvedAt } : null };
  }
  function get(userId, id) {
    const user = actor(userId);
    // This port checks membership even when a trip has no payment yet.
    tripForPayment(user, id);
    const payment = repository.find(id);
    return { settings, payment: payment ? view(owned(user, id)) : null };
  }
  function receipt(userId, id) {
    const payment = owned(actor(userId), id);
    check(payment.status === 'paid', 'RECEIPT_NOT_READY', 'A receipt is available after a successful simulated payment.');
    return { receipt: repository.receipt(id) };
  }
  // Called by rides inside the trip-completion transaction, without callbacks
  // into rides or a nested unit of work. Cancellation never invokes this port.
  function recordCompletion(data) { repository.insert(data); }

  function command({ userId, rideId, attemptId = null, action, key, data }) {
    fields(data, action === 'start' ? ['expectedVersion'] : ['expectedVersion', 'outcome']);
    check(['start', 'simulate'].includes(action), 'NOT_FOUND', 'Payment action not found.');
    if (action === 'simulate') check(['success', 'failure'].includes(data.outcome), 'INVALID_OUTCOME', 'Choose a simulated success or failure.');
    check(typeof key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(key), 'INVALID_IDEMPOTENCY_KEY', 'A unique request key is required.');
    const fingerprint = tokens.digest(JSON.stringify([action, rideId, attemptId, data.expectedVersion, data.outcome ?? null]));
    return unitOfWork(() => {
      const user = actor(userId), payment = owned(user, rideId);
      requireRole(user, 'customer');
      check(allowSimulation, 'FORBIDDEN', 'Payment simulation is available only in local development.');
      const previous = repository.findCommand(userId, key);
      if (previous) {
        check(previous.fingerprint === fingerprint, 'KEY_REUSED', 'This request key was already used for another payment action.');
        return { settings, payment: view(payment), replayed: true };
      }
      requirePaymentVersion(payment, data.expectedVersion);
      const trip = tripForPayment(user, rideId);
      check(trip.status === 'completed' && trip.amountKobo === payment.amountKobo
        && trip.customerId === payment.customerId && trip.driverId === payment.driverId,
      'PAYMENT_NOT_READY', 'Only the saved fare of a completed trip can be paid.');
      const now = clock();
      if (action === 'start') {
        check(['unpaid', 'failed'].includes(payment.status), 'PAYMENT_CLOSED', 'This payment is already pending or paid. Refresh its status.');
        attemptId = tokens.id();
        repository.insertAttempt({ id: attemptId, rideId, reference: `SIM-${attemptId.toUpperCase()}`,
          amountKobo: payment.amountKobo, currency: payment.currency, now });
        check(repository.start(rideId, attemptId, payment.version, now), 'STALE_VERSION', 'This payment changed. Refresh its status.');
        audit.record(userId, 'payment.simulation_started', rideId, now);
      } else {
        check(payment.status === 'pending' && payment.currentAttemptId === attemptId,
          'PAYMENT_CLOSED', 'Only the current pending attempt can be resolved.');
        const attempt = repository.findAttempt(attemptId);
        check(attempt?.status === 'pending' && attempt.rideId === rideId, 'PAYMENT_CLOSED', 'This attempt is closed.');
        check(attempt.amountKobo === payment.amountKobo && attempt.currency === payment.currency && attempt.provider === 'simulator',
          'PAYMENT_VERIFICATION_FAILED', 'The simulated attempt does not match the saved fare.');
        // This injected simulator is synchronous and has no I/O. A real provider
        // must run outside the transaction and use verified, durable reconciliation.
        const status = verifySimulation(simulate({ reference: attempt.reference, amountKobo: attempt.amountKobo,
          currency: attempt.currency, outcome: data.outcome }), attempt);
        check(repository.resolveAttempt(attemptId, status, now), 'PAYMENT_CLOSED', 'This attempt is closed.');
        check(repository.settle(rideId, attemptId, payment.version, status === 'succeeded' ? 'paid' : 'failed', now),
          'STALE_VERSION', 'This payment changed. Refresh its status.');
        if (status === 'succeeded') repository.saveReceipt(rideId, attemptId, {
          number: attempt.reference, reference: attempt.reference, rideId, mode: 'simulation', currency: payment.currency,
          amountKobo: payment.amountKobo, pickup: trip.pickup, destination: trip.destination,
          completedAt: trip.completedAt, paidAt: now, notice: 'SIMULATED RECEIPT — NO MONEY MOVED',
        });
        audit.record(userId, `payment.simulation_${status}`, rideId, now);
      }
      repository.saveCommand(userId, key, fingerprint, rideId, attemptId);
      return { settings, payment: view(repository.find(rideId)), replayed: false };
    });
  }

  function page(driverId, beforeId) {
    let before = null;
    if (beforeId !== null) {
      check(typeof beforeId === 'string' && /^[a-f0-9-]{36}$/.test(beforeId), 'INVALID_CURSOR', 'Invalid payment cursor.');
      before = repository.find(beforeId);
      check(before && (driverId === null || before.driverId === driverId), 'INVALID_CURSOR', 'Invalid payment cursor.');
    }
    const rows = repository.list(driverId, before, 21), items = rows.slice(0, 20);
    return { payments: items.map(view), nextBefore: rows.length > 20 ? items.at(-1).rideId : null };
  }
  function earnings(userId, beforeId = null) {
    const user = actor(userId);
    // Historical earnings remain readable if driving approval is later withdrawn.
    check(user.role === 'driver', 'FORBIDDEN', 'A driver account is required.');
    return { settings, summary: summarizePayments(repository.totals(user.id)), ...page(user.id, beforeId) };
  }
  function transactions(userId, beforeId = null) {
    requireRole(actor(userId), 'admin');
    return { settings, ...page(null, beforeId) };
  }
  return Object.freeze({ get, receipt, recordCompletion, command, earnings, transactions });
}
