import { useCallback, useRef, useState } from 'react';
import { Alert, Share } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { Text } from '../ui/typography';
import { Button, Card, Loading, Notice, Pill, fare, styles } from '../ui/components';
import { useSession } from '../session/provider';
import type { Payment, PaymentDetail, Receipt } from './contracts';

type Pending = { action: 'start' | 'simulate'; version: number; key: string; attemptId?: string; outcome?: 'success' | 'failure' };
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Could not load the trip payment.';

export function PaymentCard({ rideId }: { rideId: string }) {
  const { client, role } = useSession();
  const [detail, setDetail] = useState<PaymentDetail | null>(null), [receipt, setReceipt] = useState<Receipt | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [uncertain, setUncertain] = useState(false);
  const pending = useRef<Pending | null>(null), epoch = useRef(0), active = useRef(false), inFlight = useRef(false);
  const refresh = useCallback(async () => {
    if (!active.current || inFlight.current || pending.current) return;
    const run = epoch.current; setLoading(true);
    try {
      const next = await client.payment(rideId);
      const nextReceipt = next.payment?.status === 'paid' ? await client.receipt(rideId) : null;
      if (active.current && run === epoch.current) { setDetail(next); setReceipt(nextReceipt); setError(''); }
    } catch (e) { if (active.current && run === epoch.current) setError(errorText(e)); }
    finally { if (active.current && run === epoch.current) setLoading(false); }
  }, [client, rideId]);
  useFocusEffect(useCallback(() => {
    active.current = true; const run = ++epoch.current; void refresh();
    const changed = client.subscribeChanges(() => { if (run === epoch.current) return refresh(); });
    return () => { active.current = false; epoch.current++; changed(); pending.current = null; };
  }, [refresh]));
  async function runCommand(command: Pending) {
    if (inFlight.current || !active.current) return;
    const run = epoch.current; inFlight.current = true; setBusy(true); setError('');
    try {
      const result = await client.paymentCommand(rideId, command.action, command.version, command.key, command.attemptId, command.outcome);
      if (!active.current || run !== epoch.current) return;
      pending.current = null; setUncertain(false); setDetail(result);
      if (result.payment?.status === 'paid') {
        try { const saved = await client.receipt(rideId); if (active.current && run === epoch.current) setReceipt(saved); }
        catch (e) { if (active.current && run === epoch.current) setError(errorText(e)); }
      } else setReceipt(null);
    } catch (e) {
      if (!active.current || run !== epoch.current) return;
      const status = (e as {status?:number}).status;
      if (typeof status === 'number' && status >= 400 && status < 500) {
        pending.current = null; setUncertain(false); setError(errorText(e));
        void client.payment(rideId).then((next) => { if (active.current && run === epoch.current) setDetail(next); }).catch(() => {});
      } else { setUncertain(true); setError('Confirmation was interrupted. Retry the same payment action to check its result.'); }
    } finally { inFlight.current = false; if (active.current && run === epoch.current) setBusy(false); }
  }
  function begin(action: Pending['action'], payment: Payment, outcome?: Pending['outcome']) {
    if (busy || uncertain || pending.current) return;
    Alert.alert(action === 'start' ? 'Start test payment?' : `Simulate ${outcome}?`,
      'This is a local test. No money moves.', [{ text: 'Back', style: 'cancel' }, { text: 'Continue', onPress: () => {
        if (!active.current || pending.current) return;
        pending.current = { action, version: payment.version, attemptId: payment.attempt?.id, outcome, key: randomUUID() };
        void runCommand(pending.current);
      } }]);
  }
  return <Card><Pill>TRIP PAYMENT · TEST</Pill><Text style={styles.h2}>Trip payment</Text><Notice message={error}/>
    {loading && !detail ? <Loading/> : !detail?.payment ? <Text style={styles.body}>The payment record is not ready yet. Refresh after the trip completes.</Text> : <>
      <Text style={styles.h2}>{fare(detail.payment.amountKobo)}</Text>
      <Text style={styles.body}>Status · {detail.payment.status.replace('_', ' ')}</Text>
      {detail.payment.attempt && <Text selectable style={styles.small}>Reference · {detail.payment.attempt.reference}</Text>}
      {role === 'customer' && detail.settings.canSimulate && !uncertain && ['unpaid', 'failed'].includes(detail.payment.status) &&
        <Button title={detail.payment.status === 'failed' ? 'Retry test payment' : 'Start test payment'} disabled={busy} onPress={() => begin('start', detail.payment!)}/>}
      {role === 'customer' && detail.settings.canSimulate && !uncertain && detail.payment.status === 'pending' && <>
        <Button title="Simulate success" disabled={busy} onPress={() => begin('simulate', detail.payment!, 'success')}/>
        <Button title="Simulate failure" secondary disabled={busy} onPress={() => begin('simulate', detail.payment!, 'failure')}/>
      </>}
    </>}
    {uncertain && <Button title="Retry the same payment action" busy={busy} onPress={() => { if (pending.current) void runCommand(pending.current); }}/>}
    {receipt && <Card><Text style={styles.h2}>Receipt</Text><Text selectable style={styles.body}>{receipt.reference}</Text>
      <Text style={styles.body}>{receipt.pickup} → {receipt.destination}</Text><Text style={styles.body}>{fare(receipt.amountKobo)}</Text>
      <Text style={styles.small}>Completed {new Date(receipt.completedAt).toLocaleString()} · Recorded {new Date(receipt.paidAt).toLocaleString()}</Text>
      <Text style={styles.small}>{receipt.notice}</Text>
      <Button title="Share test receipt" secondary onPress={() => void Share.share({ message: `Taxi Ai test receipt ${receipt.reference}\n${receipt.pickup} → ${receipt.destination}\n${fare(receipt.amountKobo)}\n${receipt.notice}` }).catch((e) => setError(errorText(e)))}/></Card>}
    <Button title="Refresh payment" secondary disabled={busy || uncertain} onPress={() => void refresh()}/>
    <Text style={styles.small}>Payment simulation is available only on the local development server. No money moves.</Text>
  </Card>;
}
