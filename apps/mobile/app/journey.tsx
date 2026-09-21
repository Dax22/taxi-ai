import { Alert, Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useJourney } from '../src/journeys/provider';
import { JourneyChat } from '../src/journeys/chat';
import { TripLocationCard } from '../src/tracking/view';
import { Button, Card, Field, Heading, Loading, Notice, Pill, Screen, fare, styles } from '../src/ui/components';
import { VehicleCard } from '../src/ui/vehicle-card';
import { bookingStatusLabel } from '../../../packages/shared/src/mobile-booking.mjs';
import { vehicleCategory } from '../../../packages/shared/src/vehicle-categories.mjs';
import type { JourneyAction } from '../../../packages/shared/src/mobile-journeys.mjs';
function JourneyScreen({id}:{id:string}){
  const {state:s,controller:c}=useJourney(id),r=s.ride,locked=s.busy||s.uncertain||s.stale;
  function confirm(action:JourneyAction,title:string,detail:string){const shown=r!;Alert.alert(title,detail,[{text:'Back',style:'cancel'},{text:title,onPress:()=>void c.act(action,shown)}]);}
  const labels:Partial<Record<JourneyAction,string>>={depart:'On my way',arrive:'I have arrived',start:r?.delivery?'Verify pickup and collect parcel':'Verify pickup and start trip',complete:r?.delivery?'Verify drop-off and complete delivery':'Complete trip'};
  return <Screen><Notice message={s.error}/>{!r&&s.loading&&<Loading/>}<Button title="Refresh journey" secondary busy={s.loading} disabled={s.busy} onPress={()=>void c.refresh()}/>
    {s.uncertain&&<Button title="Retry the same action" busy={s.busy} onPress={()=>void c.retry()}/>}
    {r&&<><Button title="Safety / SOS" secondary onPress={()=>router.push({pathname:'/safety',params:{id:r.id}})}/><Pill>{bookingStatusLabel(r.status).toUpperCase()}</Pill><Heading title={`${r.pickup} → ${r.destination}`} subtitle={`${vehicleCategory(r.vehicleCategory??'standard')?.name} · ${r.mode==='work'?'Work':'Customer'}`}/>
      <Card><Text style={styles.h2}>{r.fareKobo===null?'Suggested fare':'Agreed fare'} · {fare(r.fareKobo??r.suggestedFareKobo)}</Text>
        <Text style={styles.body}>{r.mode==='work'?`Customer · ${r.customerName}`:r.driver?`Driver · ${r.driver.name}`:'Waiting for a driver to take your request.'}</Text>
        {r.driver&&<VehicleCard vehicle={r.driver.vehicle} label="VEHICLE FOR THIS JOURNEY" compact/>}
        {r.offer&&r.status==='negotiating'&&<><Pill>{r.offer.fromYou?'YOUR OFFER':'NEW OFFER'}</Pill><Text style={styles.h2}>{fare(r.offer.amountKobo)}</Text><Text style={styles.small}>{s.now>=r.offer.expiresAt?'This offer has expired.':`Expires in ${Math.max(0,Math.ceil((r.offer.expiresAt-s.now)/1000))} seconds`}</Text></>}
        {r.allowedActions.includes('accept')&&<Button title={`Accept ${fare(r.offer!.amountKobo)}`} disabled={locked||s.now>=r.offer!.expiresAt} onPress={()=>confirm('accept','Accept fare',`Accept this exact offer of ${fare(r.offer!.amountKobo)}?`)}/>}
        {r.allowedActions.includes('propose')&&<><Field label="Your fare offer (₦)" value={s.amount} keyboardType="decimal-pad" maxLength={13} editable={!locked} onChangeText={(v)=>c.edit('amount',v)}/><Button title="Send fare offer" disabled={locked||!s.amount} onPress={()=>void c.act('propose')}/></>}
        {r.allowedActions.includes('confirm')&&<Button title={`Confirm booking · ${fare(r.fareKobo!)}`} disabled={locked} onPress={()=>confirm('confirm','Confirm booking',`Book this journey for the agreed ${fare(r.fareKobo!)}?`)}/>}
        {r.status==='agreed'&&r.mode==='work'&&<Text style={styles.body}>The customer must confirm the booking before you depart.</Text>}
      </Card>
      {r.delivery&&<Card><Text style={styles.h2}>Delivery details</Text><Text style={styles.body}>{r.delivery.description} · {r.delivery.weightKg} kg</Text><Text style={styles.body}>Recipient · {r.delivery.recipientName}</Text>
        {Boolean(r.delivery.pickupInstructions)&&<Text style={styles.body}>Pickup · {r.delivery.pickupInstructions}</Text>}{Boolean(r.delivery.dropoffInstructions)&&<Text style={styles.body}>Drop-off · {r.delivery.dropoffInstructions}</Text>}
        {r.delivery.dropoffPin&&<><Text style={styles.label}>RECIPIENT’S DROP-OFF CODE</Text><Text selectable style={styles.title}>{r.delivery.dropoffPin}</Text><Text style={styles.small}>Share privately with your recipient. They give this code to the driver only after receiving the parcel.</Text></>}
      </Card>}
      {r.pickupPin&&<Card><Text style={styles.label}>YOUR PICKUP PIN</Text><Text selectable style={styles.title}>{r.pickupPin}</Text><Text style={styles.body}>Share this only when the correct driver and vehicle arrive{r.delivery?' to collect your parcel': ' and you are ready to start'}.</Text></Card>}
      {r.mode==='work'&&r.allowedActions.some((a)=>labels[a])&&<Card><Text style={styles.h2}>{r.delivery?'Delivery progress':'Trip progress'}</Text>
        {(r.allowedActions.includes('start')||r.allowedActions.includes('complete')&&r.delivery)&&<><Field label={r.status==='arrived'?'Customer’s six-digit pickup PIN':'Recipient’s six-digit drop-off code'} value={s.pin} onChangeText={(v)=>c.edit('pin',v.replace(/[^0-9]/g,''))} keyboardType="number-pad" maxLength={6} secureTextEntry editable={!locked}/>
          {(r.status==='arrived'?r.pinBlockedUntil:r.delivery?.pinBlockedUntil)!>s.now&&<Text style={styles.body}>Verification paused until {new Date((r.status==='arrived'?r.pinBlockedUntil:r.delivery?.pinBlockedUntil)!).toLocaleTimeString()}.</Text>}</>}
        {r.allowedActions.filter((a)=>labels[a]).map((a)=><Button key={a} title={labels[a]!} disabled={locked} onPress={()=>confirm(a,labels[a]!,a==='complete'?'Confirm that the journey and handover are complete.':'Update this journey to the next stage?')}/>)}
      </Card>}
      {r.status==='completed'&&<Card><Text style={styles.h2}>{r.delivery?'Delivery complete.':'You have arrived.'}</Text><Text style={styles.body}>Your journey is saved in Activity.</Text></Card>}
      <TripLocationCard id={r.id}/>
      <JourneyChat state={s} controller={c}/>
      {r.allowedActions.includes('cancel')&&<Button title="Cancel journey" secondary disabled={locked} onPress={()=>confirm('cancel','Cancel journey','Cancel this request or booking?')}/>}
      <Text style={styles.small}>Development preview · no live transport or real payment.</Text>
    </>}</Screen>;
}
export default function Journey(){const {id}=useLocalSearchParams<{id:string}>();return typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id)?<JourneyScreen key={id} id={id}/>:<Screen><Notice message="Choose a journey from Activity or Work."/></Screen>;}
