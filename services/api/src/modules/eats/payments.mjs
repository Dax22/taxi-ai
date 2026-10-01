import { check } from '../../shared/errors.mjs';
import { asyncMap } from '../../shared/async-collections.mjs';

export const FOOD_PAYMENT_RESERVATION_MS = 15 * 60_000;
const protectedOrder = order => order?.snapshot.payment?.method === 'paystack';
export const foodPaymentPending = order => protectedOrder(order) && order.snapshot.payment.status !== 'paid';
export function foodPaymentView(payment, role) {
  if (payment?.method !== 'paystack') return payment;
  const { method, status, targetId, expiresAt } = payment;
  return { method, status, ...(['customer', 'admin'].includes(role) ? { targetId, expiresAt } : {}) };
}

/** Payment settlement and inventory changes run in the caller's transaction. */
export function createEatsPayments({ repository, clock, release, onPaymentClosed }) {
  async function target(targetId) {
    const order = await repository.order(targetId);
    if (order) return { customerId: order.customerId, orders: [order], complete: order.snapshot.payment?.targetId === targetId,
      amountKobo: order.snapshot.totals.totalKobo, currency: order.snapshot.totals.currency,
      expiresAt: order.snapshot.payment?.expiresAt ?? null };
    const checkout = await repository.checkout(targetId);
    if (!checkout) return null;
    const quotes = await asyncMap(checkout.quoteIds, id => repository.quote(id));
    const orders = (await asyncMap(quotes, quote => quote?.orderId ? repository.order(quote.orderId) : null)).filter(Boolean);
    return { customerId: checkout.customerId, orders,
      complete: orders.length === quotes.length && orders.every(value => value.snapshot.payment?.targetId === targetId),
      amountKobo: quotes.reduce((sum, quote) => sum + quote.snapshot.totals.totalKobo, 0), currency: 'NGN',
      expiresAt: orders.length ? Math.min(...orders.map(value => value.snapshot.payment?.expiresAt ?? 0)) : Math.min(...quotes.map(quote => quote.expiresAt)) };
  }
  async function eligible(value, now) {
    if (!(value.complete && value.orders.length > 0 && value.expiresAt > now
      && value.orders.every(order => protectedOrder(order) && order.status === 'placed' && order.snapshot.payment.status === 'pending'))) return false;
    for (const order of value.orders) {
      const store = await repository.store(order.storeId);
      if (!store || store.status !== 'approved' || !store.isOpen) return false;
    }
    return true;
  }
  async function context(value, targetId) {
    return { kind: 'food', targetId, customerId: value.customerId, amountKobo: value.amountKobo,
      currency: value.currency, expiresAt: value.expiresAt, eligible: await eligible(value, clock()) };
  }
  async function closeOrder(order, now, status, reason) {
    if (order.status !== 'placed' || order.snapshot.payment.status !== 'pending') return;
    await release(order, now);
    order.status = 'cancelled'; order.version++; order.updatedAt = now;
    order.pickupPin = order.deliveryPin = order.pinBlockedUntil = null;
    order.snapshot.payment = { ...order.snapshot.payment, status };
    order.events.push({ status: 'cancelled', at: now, reason });
    await repository.saveOrder(order);
  }
  return Object.freeze({
    async context(user, targetId) {
      const value = await target(targetId);
      check(value?.customerId === user.id, 'NOT_FOUND', 'Food payment not found.');
      // A group member must be paid through its shared checkout, never separately.
      check(!value.orders.length || value.orders.every(order => order.snapshot.payment?.targetId === targetId), 'NOT_FOUND', 'Food payment not found.');
      return context(value, targetId);
    },
    async expire(targetId, now = clock()) {
      const value = await target(targetId);
      if (!value || value.expiresAt > now) return false;
      let changed = false;
      for (const order of value.orders) if (protectedOrder(order) && order.status === 'placed' && order.snapshot.payment.status === 'pending') {
        await closeOrder(order, now, 'expired', 'Payment reservation expired. Place a new order to continue.'); changed = true;
      }
      if (changed) await onPaymentClosed(await context(value, targetId));
      return changed;
    },
    async close(order, now) {
      if (!protectedOrder(order)) return;
      const value = await target(order.snapshot.payment.targetId);
      if (!value) return;
      const wasPaid = order.snapshot.payment.status === 'paid';
      if (wasPaid) {
        order.snapshot.payment = { ...order.snapshot.payment, status: 'refund_required' };
      } else {
        order.snapshot.payment = { ...order.snapshot.payment, status: 'expired' };
        for (const sibling of value.orders) if (sibling.id !== order.id) {
          await closeOrder(sibling, now, 'expired', 'Another kitchen order in this unpaid checkout was cancelled.');
        }
      }
      await onPaymentClosed({ ...await context(value, order.snapshot.payment.targetId), orderId: order.id,
        refundAmountKobo: wasPaid ? order.snapshot.totals.totalKobo : value.amountKobo });
    },
    async apply(record) {
      const value = await target(record.targetId), now = clock();
      if (!value || record.kind !== 'food' || value.customerId !== record.customerId
        || value.amountKobo !== record.amountKobo || value.currency !== record.currency) return { applied: false };
      if (value.complete && value.orders.every(order => order.snapshot.payment.status === 'paid' && order.snapshot.payment.paymentId === record.id)) return { applied: true };
      if (!await eligible(value, now) || record.eligible === false || record.closedAt != null) {
        for (const order of value.orders) {
          if (!protectedOrder(order) || order.snapshot.payment.targetId !== record.targetId) continue;
          await closeOrder(order, now, 'expired', 'Payment arrived after this checkout closed. Refund review is required.');
          if (order.snapshot.payment.status !== 'paid') {
            order.snapshot.payment = { ...order.snapshot.payment, status: 'refund_required', paymentId: record.id };
            order.version++; order.updatedAt = now; await repository.saveOrder(order);
          }
        }
        return { applied: false };
      }
      for (const order of value.orders) {
        order.snapshot.payment = { ...order.snapshot.payment, status: 'paid', paymentId: record.id };
        order.version++; order.updatedAt = now;
        await repository.saveOrder(order);
      }
      return { applied: true };
    },
  });
}
