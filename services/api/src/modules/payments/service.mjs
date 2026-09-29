import { check } from '../../shared/errors.mjs';
import { fields } from '../../shared/validation.mjs';
import { hasCapability, requireRole } from '../../shared/policies.mjs';
import { requirePaymentVersion, verifySimulation, summarizePayments } from './domain.mjs';
import { asyncMap } from '../../shared/async-collections.mjs';


export function createPaymentsService({ repository, getAccount, tripForPayment, simulate, unitOfWork, tokens, audit, clock, allowSimulation = false }) {
  const settings = Object.freeze({ mode: 'simulation', canSimulate: allowSimulation });
  async function actor(id) {
    const user = (await getAccount(id));
    check(user, 'UNAUTHENTICATED', 'Sign in to continue.');
    return user;
  }
  async function owned(user, id) {
    const payment = (await repository.find(id));
    check(payment && [payment.customerId, payment.driverId].includes(user.id), 'NOT_FOUND', 'Payment not found.');
    return payment;
  }
  async function view(payment) {
    const { customerId, driverId, currentAttemptId, ...publicFields } = payment;
    const attempt = currentAttemptId ? (await repository.findAttempt(currentAttemptId)) : null;
    return { ...publicFields, attempt: attempt ? { id: attempt.id, reference: attempt.reference, status: attempt.status,
      createdAt: attempt.createdAt, resolvedAt: attempt.resolvedAt } : null };
  }
  async function get(userId, id) {
    const user = (await actor(userId));
    // This port checks membership even when a trip has no payment yet.
    (await tripForPayment(user, id));
    const payment = (await repository.find(id));
    return { settings, payment: payment ? (await view((await owned(user, id)))) : null };
  }
  async function receipt(userId, id) {
    const payment = (await owned((await actor(userId)), id));
    check(payment.status === 'paid', 'RECEIPT_NOT_READY', 'A receipt is available after a successful simulated payment.');
    return { receipt: (await repository.receipt(id)) };
  }
  // Called by rides inside the trip-completion transaction, without callbacks
  // into rides or a nested unit of work. Cancellation never invokes this port.
  async function recordCompletion(data) { (await repository.insert(data)); }

  async function command({ userId, rideId, attemptId = null, action, key, data }) {
    fields(data, action === 'start' ? ['expectedVersion'] : ['expectedVersion', 'outcome']);
    check(['start', 'simulate'].includes(action), 'NOT_FOUND', 'Payment action not found.');
    if (action === 'simulate') check(['success', 'failure'].includes(data.outcome), 'INVALID_OUTCOME', 'Choose a simulated success or failure.');
    check(typeof key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(key), 'INVALID_IDEMPOTENCY_KEY', 'A unique request key is required.');
    const fingerprint = tokens.digest(JSON.stringify([action, rideId, attemptId, data.expectedVersion, data.outcome ?? null]));
    return (await unitOfWork(async () => {
      const user = (await actor(userId)), payment = (await owned(user, rideId));
      requireRole(user, 'customer');
      check(payment.customerId === user.id, 'FORBIDDEN', 'Only the booking account can pay for this trip.');
      check(allowSimulation, 'FORBIDDEN', 'Payment simulation is available only in local development.');
      const previous = (await repository.findCommand(userId, key));
      if (previous) {
        check(previous.fingerprint === fingerprint, 'KEY_REUSED', 'This request key was already used for another payment action.');
        return { settings, payment: (await view(payment)), replayed: true };
      }
      requirePaymentVersion(payment, data.expectedVersion);
      const trip = (await tripForPayment(user, rideId));
      check(trip.status === 'completed' && trip.amountKobo === payment.amountKobo
        && trip.customerId === payment.customerId && trip.driverId === payment.driverId,
      'PAYMENT_NOT_READY', 'Only the saved fare of a completed trip can be paid.');
      const now = clock();
      if (action === 'start') {
        check(['unpaid', 'failed'].includes(payment.status), 'PAYMENT_CLOSED', 'This payment is already pending or paid. Refresh its status.');
        attemptId = tokens.id();
        (await repository.insertAttempt({ id: attemptId, rideId, reference: `SIM-${attemptId.toUpperCase()}`,
          amountKobo: payment.amountKobo, currency: payment.currency, now }));
        check((await repository.start(rideId, attemptId, payment.version, now)), 'STALE_VERSION', 'This payment changed. Refresh its status.');
        (await audit.record(userId, 'payment.simulation_started', rideId, now));
      } else {
        check(payment.status === 'pending' && payment.currentAttemptId === attemptId,
          'PAYMENT_CLOSED', 'Only the current pending attempt can be resolved.');
        const attempt = (await repository.findAttempt(attemptId));
        check(attempt?.status === 'pending' && attempt.rideId === rideId, 'PAYMENT_CLOSED', 'This attempt is closed.');
        check(attempt.amountKobo === payment.amountKobo && attempt.currency === payment.currency && attempt.provider === 'simulator',
          'PAYMENT_VERIFICATION_FAILED', 'The simulated attempt does not match the saved fare.');
        // This injected simulator is synchronous and has no I/O. A real provider
        // must run outside the transaction and use verified, durable reconciliation.
        const status = verifySimulation(simulate({ reference: attempt.reference, amountKobo: attempt.amountKobo,
          currency: attempt.currency, outcome: data.outcome }), attempt);
        check((await repository.resolveAttempt(attemptId, status, now)), 'PAYMENT_CLOSED', 'This attempt is closed.');
        check((await repository.settle(rideId, attemptId, payment.version, status === 'succeeded' ? 'paid' : 'failed', now)),
          'STALE_VERSION', 'This payment changed. Refresh its status.');
        if (status === 'succeeded') (await repository.saveReceipt(rideId, attemptId, {
          number: attempt.reference, reference: attempt.reference, rideId, mode: 'simulation', currency: payment.currency,
          amountKobo: payment.amountKobo, pickup: trip.pickup, destination: trip.destination,
          completedAt: trip.completedAt, paidAt: now, notice: 'SIMULATED RECEIPT — NO MONEY MOVED',
        }));
        (await audit.record(userId, `payment.simulation_${status}`, rideId, now));
      }
      (await repository.saveCommand(userId, key, fingerprint, rideId, attemptId));
      return { settings, payment: (await view((await repository.find(rideId)))), replayed: false };
    }));
  }

  async function page(driverId, beforeId) {
    let before = null;
    if (beforeId !== null) {
      check(typeof beforeId === 'string' && /^[a-f0-9-]{36}$/.test(beforeId), 'INVALID_CURSOR', 'Invalid payment cursor.');
      before = (await repository.find(beforeId));
      check(before && (driverId === null || before.driverId === driverId), 'INVALID_CURSOR', 'Invalid payment cursor.');
    }
    const rows = (await repository.list(driverId, before, 21)), items = rows.slice(0, 20);
    return { payments: (await asyncMap(items, view)), nextBefore: rows.length > 20 ? items.at(-1).rideId : null };
  }
  async function earnings(userId, beforeId = null) {
    const user = (await actor(userId));
    // Historical earnings remain readable if driving approval is later withdrawn.
    check(hasCapability(user, 'driver'), 'FORBIDDEN', 'A driver account is required.');
    return { settings, summary: summarizePayments((await repository.totals(user.id))), ...(await page(user.id, beforeId)) };
  }
  async function transactions(userId, beforeId = null) {
    requireRole((await actor(userId)), 'admin');
    return { settings, ...(await page(null, beforeId)) };
  }
  return Object.freeze({ get, receipt, recordCompletion, command, earnings, transactions });
}
