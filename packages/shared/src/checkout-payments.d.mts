export type CheckoutPaymentKind = 'ride' | 'food';
export type CheckoutPaymentStatus = 'initializing' | 'pending' | 'unknown' | 'failed' | 'paid' | 'refund_required';
export type CheckoutProviderMode = 'test' | 'live';
export interface CheckoutPaymentReceipt { reference: string; amountKobo: number; currency: 'NGN'; paidAt: number; provider: 'paystack'; mode: CheckoutProviderMode; notice: string }
export interface CheckoutPayment {
  id: string; kind: CheckoutPaymentKind; targetId: string; status: CheckoutPaymentStatus; amountKobo: number; currency: 'NGN'; providerMode: CheckoutProviderMode;
  version: number; checkoutUrl: string | null; reference: string | null; refundRequired: boolean; createdAt: number; updatedAt: number;
  paidAt: number | null; receipt: CheckoutPaymentReceipt | null; refundAmountKobo?: number | null;
}
export interface CheckoutPaymentDetail {
  settings: { provider: 'paystack'; mode: CheckoutProviderMode; enabled: boolean; walletStrategy: 'paystack_hosted';
    walletCandidates: ['apple_pay','google_pay']; walletAvailability: 'provider_device_eligibility' };
  payment: CheckoutPayment | null; canStart: boolean; isPayer: boolean; replayed?: boolean;
}
export function safeCheckoutUrl(value: unknown): string | null;
export function readCheckoutPaymentResponse(value: unknown, expected: { kind: CheckoutPaymentKind; targetId: string }): CheckoutPaymentDetail;
