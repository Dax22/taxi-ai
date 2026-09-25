import { check } from '../../shared/errors.mjs';
import { identifier, financeFilters, paymentSummary, attemptSummary, receiptSummary, page, summarizeFinance, STALE_PENDING_MS } from './domain.mjs';

const availability = Object.freeze({ gateway: false, eatsPayments: false, fees: false, commission: false, refunds: false, payouts: false });

/** This is local simulation accounting, not provider reconciliation or a money
 * movement API. Staff permission is checked inside every read transaction. */
export function createAdminFinanceService({ repository, requirePermission, unitOfWork, clock, audit }) {
  const envelope = (user, now) => ({ viewerId: user.id, asOf: now, paymentMode: 'simulation', provider: 'not_configured',
    availability, integrityPolicy: { basis: 'saved_local_records', stalePendingSeconds: STALE_PENDING_MS / 1000 } });
  return Object.freeze({
    async get(user, query = {}) {
      return unitOfWork(async () => {
        await requirePermission(user.id, 'finance.read');
        const now = clock(), filter = financeFilters(query, now);
        const summary = await summarizeFinance(repository.facts(filter), now);
        const result = page(await repository.list(filter), filter, 'completedAt', 'rideId');
        await requirePermission(user.id, 'finance.read');
        return { ...envelope(user, now), scope: filter.range,
          filters: { from: filter.range.from, to: filter.range.to, status: filter.status, q: filter.q, limit: filter.limit },
          summary, payments: result.items.map((row) => paymentSummary(row, now)), page: result.page };
      });
    },
    async detail(user, id, query = {}) {
      return unitOfWork(async () => {
        await requirePermission(user.id, 'finance.read');
        identifier(id); const now = clock(), filter = financeFilters(query, now, true), row = await repository.get(id);
        check(row, 'NOT_FOUND', 'Payment record not found.');
        const payment = paymentSummary(row, now), result = page(await repository.attempts(id, filter), filter, 'createdAt', 'id');
        await requirePermission(user.id, 'finance.read');
        await audit.record(user.id, 'admin.finance.payment.view', id, now);
        return { ...envelope(user, now), payment, attempts: result.items.map(attemptSummary), receipt: receiptSummary(row),
          findings: payment.findings, page: result.page };
      });
    },
  });
}
