import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { Linking, Share } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import type { CheckoutPaymentKind, CheckoutPaymentStatus } from '../../../../packages/shared/src/checkout-payments.mjs';
import { safeCheckoutUrl } from '../../../../packages/shared/src/checkout-payments.mjs';
import { useSession } from '../session/provider';
import { Button, Card, Loading, Notice, Pill, fare, styles } from '../ui/components';
import { Text } from '../ui/typography';
import { CheckoutPaymentController } from './checkout-controller';

const statuses: Record<CheckoutPaymentStatus, string> = {
  initializing: 'Preparing test checkout', pending: 'Awaiting test payment', unknown: 'Payment result needs checking',
  paid: 'Test payment confirmed', refund_required: 'Refund review required', failed: 'Test payment was not completed',
};
export function CheckoutPaymentCard({ kind, targetId, grouped = false, fallback = null }: {
  kind: CheckoutPaymentKind; targetId: string; grouped?: boolean; fallback?: ReactNode;
}) {
  const { client, user, blocked } = useSession();
  const c = useMemo(() => new CheckoutPaymentController(client, kind, targetId, randomUUID), [client, user?.id, kind, targetId]);
  const s = useSyncExternalStore(c.subscribe, c.snapshot), detail = s.detail, payment = detail?.payment;
  const mounted = useRef<CheckoutPaymentController | null>(null);
  useEffect(() => {
    mounted.current = c;
    return () => { mounted.current = null; queueMicrotask(() => { if (mounted.current !== c) c.dispose(); }); };
  }, [c]);
  useFocusEffect(useCallback(() => {
    if (user && !blocked) c.activate();
    const changed = client.subscribeChanges(() => c.load());
    return () => { changed(); c.pause(); };
  }, [c, client, user?.id, blocked]));
  async function openCheckout() {
    const url = safeCheckoutUrl(c.checkoutUrl());
    if (!url) return;
    c.markCheckoutOpened();
    try { await Linking.openURL(url); } catch (error) { c.reportError(error); }
  }
  if (detail && !detail.settings.enabled && !payment) return <>{fallback}</>;
  return <Card><Pill>PAYSTACK · TEST MODE</Pill><Text style={styles.h2}>{kind === 'food' ? 'Food checkout' : 'Journey payment'}</Text>
    <Text style={styles.small}>Use Paystack test payment details only. No live money moves.</Text>
    {grouped && <Text style={styles.body}>This payment covers all kitchens in this checkout.</Text>}
    <Notice message={s.error}/>
    {s.loading && !detail && <Loading/>}
    {payment ? <>
      <Text style={styles.h2}>{fare(payment.amountKobo)}</Text><Text style={styles.body}>{statuses[payment.status]}</Text>
      {!!payment.reference && <Text selectable style={styles.small}>Reference · {payment.reference}</Text>}
      {payment.refundRequired && <Text style={styles.body}>This test payment needs manual refund review{payment.refundAmountKobo != null ? ` for ${fare(payment.refundAmountKobo)}` : ''}. A refund has not been confirmed.</Text>}
      {['initializing', 'unknown'].includes(payment.status) && <Text style={styles.body}>Check the payment result before trying another action. Returning from checkout does not confirm payment.</Text>}
      {payment.status === 'failed' && <Text style={styles.body}>The payment provider did not confirm success. Check this payment again to confirm its latest result.</Text>}
    </> : detail && <Text style={styles.body}>{detail.canStart ? 'Prepare your secure test checkout to continue on Paystack.' : detail.isPayer ? 'Test checkout is not currently available for this booking or order.' : 'The person who booked manages this payment.'}</Text>}
    {s.returned && payment?.status !== 'paid' && <Text style={styles.body}>After returning from Paystack, choose Check payment. Only a verified provider result confirms payment.</Text>}
    {detail?.canStart && !payment && <Button title="Prepare Paystack test checkout" busy={s.busy} disabled={s.stale || s.uncertain || s.loading} onPress={() => void c.act('start')}/>}
    {c.checkoutUrl() && <Button title="Open Paystack test checkout ↗" disabled={s.busy || s.loading || s.uncertain} onPress={() => void openCheckout()}/>}
    {detail?.isPayer && payment && <Button title="Check payment" secondary busy={s.busy} disabled={s.stale || s.loading || s.uncertain} onPress={() => void c.act('refresh')}/>}
    {s.uncertain && <Button title="Retry the same payment action" busy={s.busy} disabled={s.loading} onPress={() => void c.retry()}/>}
    {payment?.receipt && <Card><Text style={styles.h2}>Paystack test receipt</Text>
      <Text selectable style={styles.body}>{payment.receipt.reference}</Text><Text style={styles.body}>{fare(payment.receipt.amountKobo)}</Text>
      <Text style={styles.small}>Confirmed {new Date(payment.receipt.paidAt).toLocaleString()}</Text><Text style={styles.small}>{payment.receipt.notice}</Text>
      <Button title="Share test receipt" secondary onPress={() => {
        const receipt = c.snapshot().detail?.payment?.receipt;
        if (!receipt || c.snapshot().stale || blocked) return;
        void Share.share({ message: `Taxi Ai Paystack test receipt\n${receipt.reference}\n${fare(receipt.amountKobo)}\n${receipt.notice}` }).catch(error => c.reportError(error));
      }}/>
    </Card>}
    <Button title="Reload payment details" secondary busy={s.loading} disabled={s.busy || s.uncertain} onPress={() => void c.load()}/>
  </Card>;
}
