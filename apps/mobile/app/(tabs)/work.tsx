import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { Text } from 'react-native';
import { useSession } from '../../src/session/provider';
import { useWork } from '../../src/journeys/provider';
import { Button, Card, Heading, Notice, Pill, Screen, fare, styles } from '../../src/ui/components';
import { SelectField } from '../../src/ui/select-field';
import { VehicleCard } from '../../src/ui/vehicle-card';
import { vehicleCategory } from '../../../../packages/shared/src/vehicle-categories.mjs';
export default function Work(){
  const {user,blocked}=useSession(),{state:s,controller:c}=useWork();const [area,setArea]=useState('');
  const eligible=Boolean(user?.driver?.eligibility.eligible),locked=s.busy||s.uncertain||s.stale;
  const online=Boolean(s.availability?.online&&s.availability.expiresAt&&s.now<s.availability.expiresAt);
  useEffect(()=>{if(s.journey&&!blocked){const id=s.journey.id;c.clearJourney();router.push({pathname:'/journey',params:{id}});}},[s.journey,blocked,c]);
  return <Screen><Pill>WORK</Pill><Heading title="Ready when you are." subtitle="Choose when to receive nearby requests."/><Notice message={s.error}/>
    {!user?.driver?<Card><Text style={styles.h2}>Drive or deliver with Taxi Ai.</Text><Button title="Start driver application" onPress={()=>router.push('/driver-application')}/></Card>:<>
      <VehicleCard vehicle={user.driver.vehicle} compact/>
      <Button title="View driver application" secondary onPress={()=>router.push('/driver-application')}/>
      <Card><Pill>{online?(s.availability?.owned?'ONLINE ON THIS PHONE':'ONLINE ON ANOTHER DEVICE'):'OFFLINE'}</Pill>
        <Text style={styles.body}>{eligible?'Keep Taxi Ai open to receive requests. Leaving the app stops location updates and takes you offline.':'Complete your application and approval before taking new jobs.'}</Text>
        <Text style={styles.small}>Your precise location is used to find nearby work. Customers do not see your availability location.</Text>
        {online?<Button title="Go offline" secondary disabled={s.busy||s.uncertain} onPress={()=>void c.offline()}/>:<Button title="Go online with my location" busy={s.busy} disabled={!eligible||locked||Boolean(s.work?.current.length)||Boolean(s.work?.activeElsewhere.length)} onPress={()=>void c.online()}/>}
        {s.work?.settings.allowSimulation&&!online&&<><SelectField label="Local sample area" value={area} onChange={setArea} disabled={locked} options={s.work.areas.map((a)=>({value:a.id,label:a.name}))}/><Button title="Go online in sample area" secondary disabled={!eligible||locked||!area||Boolean(s.work.current.length)||Boolean(s.work.activeElsewhere.length)} onPress={()=>void c.online(area)}/></>}
        {s.uncertain&&<Button title="Retry the same work action" busy={s.busy} onPress={()=>void c.retry()}/>}
        <Button title="Refresh work" secondary busy={s.loading} disabled={s.busy} onPress={()=>void c.refresh()}/>
      </Card>
      {s.work?.activeElsewhere.map((j)=><Card key={j.id}><Text style={styles.body}>You have a personal journey to finish.</Text><Button title="View personal journey" onPress={()=>router.push({pathname:'/journey',params:{id:j.id}})}/></Card>)}
      {s.work?.current.map((j)=><Card key={j.id}><Pill>CURRENT JOB</Pill><Text style={styles.h2}>{j.pickup} → {j.destination}</Text><Button title="Open journey" onPress={()=>router.push({pathname:'/journey',params:{id:j.id}})}/></Card>)}
      <Heading title="Nearby requests." subtitle={online?'Requests match your approved vehicle category and capacity.':'Go online to see available work.'}/>
      {online&&!s.work?.available.length&&<Text style={styles.body}>No matching requests yet. This screen refreshes while the app is open.</Text>}
      {online&&s.work?.available.map((job)=><Card key={job.id}><Pill>{vehicleCategory(job.vehicleCategory)?.name.toUpperCase()??'REQUEST'}</Pill>
        <Text style={styles.h2}>{job.pickup} → {job.destination}</Text><Text style={styles.body}>Suggested fare · {fare(job.suggestedFareKobo)}</Text>
        {job.approximateDistanceKm!==null&&<Text style={styles.small}>About {job.approximateDistanceKm} km from pickup</Text>}
        <Text style={styles.small}>Taking this request opens a conversation to agree the fare.</Text>
        <Button title="Take request and discuss fare" disabled={locked||s.now>=job.expiresAt} onPress={()=>void c.claim(job)}/></Card>)}
    </>}<Text style={styles.small}>Development preview · no live transport.</Text></Screen>;
}
