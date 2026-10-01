export type CheckoutPaymentKind = 'ride' | 'food';
export type CheckoutPaymentStatus = 'initializing' | 'pending' | 'unknown' | 'failed' | 'paid' | 'refund_required';
export interface CheckoutPaymentReceipt { reference: string; amountKobo: number; currency: 'NGN'; paidAt: number; provider: 'paystack'; mode: 'test'; notice: string }
export interface CheckoutPayment {
  id: string; kind: CheckoutPaymentKind; targetId: string; status: CheckoutPaymentStatus; amountKobo: number; currency: 'NGN';
  version: number; checkoutUrl: string | null; reference: string | null; refundRequired: boolean; createdAt: number; updatedAt: number;
  paidAt: number | null; receipt: CheckoutPaymentReceipt | null; refundAmountKobo?: number | null;
}
export interface CheckoutPaymentDetail {
  settings: { provider: 'paystack'; mode: 'test'; enabled: boolean }; payment: CheckoutPayment | null;
  canStart: boolean; isPayer: boolean; replayed?: boolean;
}
export function safeCheckoutUrl(value: unknown): string | null;
export function readCheckoutPaymentResponse(value: unknown, expected: { kind: CheckoutPaymentKind; targetId: string }): CheckoutPaymentDetail;
