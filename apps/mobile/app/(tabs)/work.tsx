import { useEffect, useState } from 'react';
import { Redirect, router } from 'expo-router';
import { Text } from '../../src/ui/typography';
import { useSession } from '../../src/session/provider';
import { useWork } from '../../src/journeys/provider';
import { Button, Card, Heading, Notice, Pill, Screen, fare, styles } from '../../src/ui/components';
import { SelectField } from '../../src/ui/select-field';
import { WorkProfileControls } from '../../src/ui/work-profile-controls';
import { vehicleCategory } from '../../../../packages/shared/src/vehicle-categories.mjs';
import { MATCH_REASON_LABELS } from '../../../../packages/shared/src/smart-matching.mjs';
import { PassengerSummary } from '../../src/guest-rides/passenger-summary';
export default function Work(){
  const {user,role,blocked}=useSession(),{state:s,controller:c}=useWork();const [area,setArea]=useState('');
  const eligible=Boolean(user?.driver?.eligibility.eligible),locked=s.busy||s.uncertain||s.stale;
  const online=Boolean(s.availability?.online&&s.availability.expiresAt&&s.now<s.availability.expiresAt);
  const timedOffers=s.work?.settings.dispatchMode&&s.work.settings.dispatchMode!=='legacy';
  useEffect(()=>{if(s.journey&&!blocked){const id=s.journey.id;c.clearJourney();router.push({pathname:'/journey',params:{id}});}},[s.journey,blocked,c]);
  if (role !== 'driver') return <Redirect href="/"/>;
  return <Screen><Pill>DRIVER</Pill><Heading title="Ready when you are." subtitle="Choose when to receive nearby requests."/><Notice message={s.error}/>
    {!user?.driver?<Card><Text style={styles.h2}>Drive or deliver with Taxi Ai.</Text><Button title="Start driver application" onPress={()=>router.push('/driver-application')}/></Card>:<>
      <WorkProfileControls/>
      <Card><Text style={styles.h2}>Your earnings preview</Text><Text style={styles.body}>See completed fares and simulated payment status.</Text><Button title="Open earnings" secondary onPress={() => router.push('/earnings')}/></Card>
      <Card><Text style={styles.h2}>Deliver with Taxi Ai Eats</Text><Text style={styles.body}>Collect ready food orders with your approved motorcycle, car, SUV or van. Go online below, then check food deliveries.</Text><Button title="Food deliveries & current order" secondary onPress={() => router.push('/food-work')}/></Card>
      <Card><Pill>{online?(s.availability?.owned?'ONLINE ON THIS PHONE':'ONLINE ON ANOTHER DEVICE'):'OFFLINE'}</Pill>
        <Text style={styles.body}>{eligible?'Keep Taxi Ai open to receive requests. Leaving the app stops location updates and takes you offline.':'Complete your application and approval before taking new jobs.'}</Text>
        <Text style={styles.small}>Your precise location is used to find nearby work. Customers do not see your availability location.</Text>
        {online?<Button title="Go offline" secondary disabled={s.busy||s.uncertain} onPress={()=>void c.offline()}/>:<Button title="Go online with my location" busy={s.busy} disabled={!eligible||locked||Boolean(s.work?.current.length)||Boolean(s.work?.activeElsewhere.length)} onPress={()=>void c.online()}/>}
        {s.work?.settings.allowSimulation&&!online&&<><SelectField label="Local sample area" value={area} onChange={setArea} disabled={locked} options={s.work.areas.map((a)=>({value:a.id,label:a.name}))}/><Button title="Go online in sample area" secondary disabled={!eligible||locked||!area||Boolean(s.work.current.length)||Boolean(s.work.activeElsewhere.length)} onPress={()=>void c.online(area)}/></>}
        {s.uncertain&&<Button title="Retry the same work action" busy={s.busy} onPress={()=>void c.retry()}/>}
        <Button title="Refresh work" secondary busy={s.loading} disabled={s.busy} onPress={()=>void c.refresh()}/>
      </Card>
      {s.work?.activeElsewhere.map((j)=><Card key={j.id}><Text style={styles.body}>You have a personal journey to finish.</Text><Button title="View personal journey" onPress={()=>router.push({pathname:'/journey',params:{id:j.id}})}/></Card>)}
      {s.work?.current.map((j)=><Card key={j.id}><Pill>CURRENT JOB</Pill><Text style={styles.h2}>{j.pickup} → {j.destination}</Text><PassengerSummary passenger={j.passenger} bookedBy={j.customerName}/><Button title="Open journey" onPress={()=>router.push({pathname:'/journey',params:{id:j.id}})}/></Card>)}
      <Heading title={timedOffers?'Ride offers.':'Nearby requests.'} subtitle={online?(timedOffers?'Review each timed offer, then accept to negotiate the fare.':'Eligible requests are ordered by pickup distance and customer waiting time.'):'Go online to see available work.'}/>
      {online&&!s.work?.available.length&&<Text style={styles.body}>No matching requests yet. This screen refreshes while the app is open.</Text>}
      {online&&s.work?.available.map((job)=><Card key={job.id}><Pill>{vehicleCategory(job.vehicleCategory)?.name.toUpperCase()??'REQUEST'}</Pill>
        {job.offer&&<Text style={styles.h2}>Ride offer</Text>}
        <Text style={styles.h2}>{job.pickup} → {job.destination}</Text><Text style={styles.body}>Suggested fare · {fare(job.suggestedFareKobo)}</Text>
        <Text style={styles.small}>Matches your approved vehicle category and capacity.</Text>
        {job.offer?.etaSource==='road'&&<Text style={styles.body}>About {job.offer.pickupEtaMinutes} min to pickup · road estimate</Text>}
        {job.offer?.etaSource==='distance_fallback'&&<Text style={styles.small}>Road estimate unavailable</Text>}
        {(job.offer?.etaSource==='sample'||!job.offer&&s.availability?.mode==='sample')&&<Text style={styles.small}>Local sample-area match · no road estimate</Text>}
        {job.approximateDistanceKm!==null&&job.offer?.etaSource!=='road'&&<Text style={styles.small}>Within about {Math.max(1,job.approximateDistanceKm)} km in a straight line · driving time varies</Text>}
        {!job.offer&&job.recommendation&&<Text style={styles.small}>{job.recommendation.reasons.map((reason)=>MATCH_REASON_LABELS[reason]).join(' · ')}</Text>}
        {job.offer&&<Text style={styles.body}>{s.now<Math.min(job.expiresAt,job.offer.expiresAt)?`Respond within ${Math.ceil((Math.min(job.expiresAt,job.offer.expiresAt)-s.now)/1000)} seconds.`:'Offer expired. Waiting for the next request.'}</Text>}
        <Text style={styles.small}>Accepting opens fare negotiation. Both sides must agree before booking.</Text>
        <Button title={job.offer?'Accept and negotiate':'Take request and discuss fare'} disabled={locked||s.now>=Math.min(job.expiresAt,job.offer?.expiresAt??job.expiresAt)} onPress={()=>void c.claim(job)}/>
        {job.offer&&<Button title="Decline offer" secondary disabled={locked||s.now>=Math.min(job.expiresAt,job.offer.expiresAt)} onPress={()=>void c.decline(job)}/>}</Card>)}
    </>}<Text style={styles.small}>Development preview · no live transport.</Text></Screen>;
}
