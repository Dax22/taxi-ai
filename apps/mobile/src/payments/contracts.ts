export interface Payment {
  rideId: string; version: number; status: 'unpaid' | 'pending' | 'failed' | 'paid'; amountKobo: number; currency: 'NGN';
  attempt: { id: string; reference: string; status: string } | null; completedAt: number;
}
export interface PaymentDetail { settings: { canSimulate: boolean }; payment: Payment | null }
export interface Receipt { reference: string; pickup: string; destination: string; amountKobo: number; completedAt: number; paidAt: number; notice: string }
export interface Earnings { summary: { completedTrips: number; paidTrips: number; pendingTrips: number; failedTrips: number; unpaidTrips: number;
  grossFareKobo: string; simulatedPaidKobo: string; outstandingKobo: string }; payments: Payment[]; nextBefore: string | null }
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Taxi Ai returned an invalid payment record.');
  return value as Record<string, unknown>;
};
const validPayment = (value: unknown): Payment => {
  const p = record(value);
  if (typeof p.rideId !== 'string' || !Number.isSafeInteger(p.version) || !['unpaid','pending','failed','paid'].includes(String(p.status))
    || !Number.isSafeInteger(p.amountKobo) || Number(p.amountKobo) < 0 || p.currency !== 'NGN'
    || typeof p.completedAt !== 'number' || (p.attempt !== null && (typeof record(p.attempt).id !== 'string' || typeof record(p.attempt).reference !== 'string'))) {
    throw new Error('Taxi Ai returned an invalid payment record.');
  }
  return p as unknown as Payment;
};
export function readPayment(value: unknown): PaymentDetail {
  const body = record(value), settings = record(body.settings);
  if (typeof settings.canSimulate !== 'boolean') throw new Error('Taxi Ai returned invalid payment settings.');
  return { settings: { canSimulate: settings.canSimulate }, payment: body.payment === null ? null : validPayment(body.payment) };
}
export function readReceipt(value: unknown): Receipt {
  const r = record(record(value).receipt);
  if (typeof r.reference !== 'string' || typeof r.pickup !== 'string' || typeof r.destination !== 'string'
    || !Number.isSafeInteger(r.amountKobo) || typeof r.completedAt !== 'number' || typeof r.paidAt !== 'number' || typeof r.notice !== 'string') {
    throw new Error('Taxi Ai returned an invalid receipt.');
  }
  return r as unknown as Receipt;
}
export function readEarnings(value: unknown): Earnings {
  const body = record(value), summary = record(body.summary);
  if (!Array.isArray(body.payments) || !(body.nextBefore === null || typeof body.nextBefore === 'string')
    || !['completedTrips','paidTrips','pendingTrips','failedTrips','unpaidTrips'].every((key) => Number.isSafeInteger(summary[key]))
    || !['grossFareKobo','simulatedPaidKobo','outstandingKobo'].every((key) => typeof summary[key] === 'string' && /^\d+$/.test(summary[key] as string))) {
    throw new Error('Taxi Ai returned invalid earnings.');
  }
  return { summary: summary as unknown as Earnings['summary'], payments: body.payments.map(validPayment), nextBefore: body.nextBefore as string | null };
}
