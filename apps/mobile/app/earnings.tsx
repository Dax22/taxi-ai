import { useCallback, useState } from 'react';
import { Redirect, router } from 'expo-router';
import { Text } from '../src/ui/typography';
import { useSession } from '../src/session/provider';
import { useResource } from '../src/ui/use-resource';
import { Button, Card, Heading, Loading, Notice, Pill, Screen, fare, styles } from '../src/ui/components';

function total(value: string) { const kobo = BigInt(value); return `₦${(kobo / 100n).toLocaleString('en-NG')}.${String(kobo % 100n).padStart(2, '0')}`; }
export default function Earnings() {
  const { client, role } = useSession(), [before, setBefore] = useState<string | null>(null);
  const resource = useResource(useCallback(() => client.earnings(before), [client, before]));
  if (role !== 'driver') return <Redirect href="/"/>;
  const data = resource.value;
  return <Screen><Pill>DRIVER · TEST PREVIEW</Pill><Heading title="Your earnings." subtitle="Completed journeys and their saved payment status."/>
    <Notice message={resource.error}/>
    {resource.busy && <Loading/>}
    {data && <><Card><Text style={styles.h2}>Trip totals</Text>
      <Text style={styles.body}>Agreed fares · {total(data.summary.grossFareKobo)}</Text>
      <Text style={styles.body}>Simulated paid · {total(data.summary.simulatedPaidKobo)}</Text>
      <Text style={styles.body}>Outstanding · {total(data.summary.outstandingKobo)}</Text>
      <Text style={styles.small}>{data.summary.completedTrips} completed · {data.summary.paidTrips} paid · {data.summary.pendingTrips} pending · {data.summary.failedTrips} failed · {data.summary.unpaidTrips} not started</Text>
    </Card>
    {data.payments.length === 0 && <Text style={styles.body}>No completed journeys on this page yet.</Text>}
    {data.payments.map((payment) => <Card key={payment.rideId}><Text style={styles.h2}>{fare(payment.amountKobo)}</Text>
      <Text style={styles.body}>Payment · {payment.status}</Text><Text style={styles.small}>{new Date(payment.completedAt).toLocaleString()}</Text>
      <Button title="Open trip and receipt" secondary onPress={() => router.push({ pathname: '/journey', params: { id: payment.rideId } })}/></Card>)}
    <Button title="Refresh earnings" secondary onPress={resource.reload}/>
    {data.nextBefore && <Button title="Older payments" secondary onPress={() => setBefore(data.nextBefore)}/>}
    {before && <Button title="Latest payments" secondary onPress={() => setBefore(null)}/>}
    </>}
    <Text style={styles.small}>These are simulated payment records. No money or payout moves.</Text>
  </Screen>;
}
