import { useEffect, useState } from 'react';
import { Redirect, router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../src/ui/typography';
import { useSession } from '../../src/session/provider';
import { useWork } from '../../src/journeys/provider';
import { Button, Card, Heading, Notice, Pill, colors, fare, styles } from '../../src/ui/components';
import { SelectField } from '../../src/ui/select-field';
import { WorkProfileControls } from '../../src/ui/work-profile-controls';
import { vehicleCategory } from '../../../../packages/shared/src/vehicle-categories.mjs';
import { MATCH_REASON_LABELS } from '../../../../packages/shared/src/smart-matching.mjs';
import { PassengerSummary } from '../../src/guest-rides/passenger-summary';
import { MapScaffold } from '../../src/maps/map-scaffold';
import { useDeviceMapPosition } from '../../src/maps/device-position';

export default function Work(){
  const {user,role,blocked}=useSession(),{state:s,controller:c}=useWork(),location=useDeviceMapPosition();const [area,setArea]=useState('');
  const eligible=Boolean(user?.driver?.eligibility.eligible),locked=s.busy||s.uncertain||s.stale;
  const online=Boolean(s.availability?.online&&s.availability.expiresAt&&s.now<s.availability.expiresAt);
  const timedOffers=s.work?.settings.dispatchMode&&s.work.settings.dispatchMode!=='legacy';
  const current=s.work?.current[0],route=current?.route?.coordinates.map(([lng,lat])=>({lng,lat}))??[];
  const position=location.position;
  const pins=[
    ...(current?.route?[{id:'pickup',lat:current.route.pickup.lat,lng:current.route.pickup.lng,title:'Pickup'},{id:'destination',lat:current.route.destination.lat,lng:current.route.destination.lng,title:'Destination'}]:[]),
    ...(position?[{id:'me',lat:position.lat,lng:position.lng,title:'Your phone location',description:online?'Used to find nearby work':'Map position on this phone'}]:[]),
  ];
  useEffect(()=>{if(s.journey&&!blocked){const id=s.journey.id;c.clearJourney();router.push({pathname:'/journey',params:{id}});}},[s.journey,blocked,c]);
  if (role !== 'driver') return <Redirect href="/"/>;
  const status=online?(s.availability?.owned?'ONLINE':'ONLINE · OTHER DEVICE'):'OFFLINE';
  return <MapScaffold pins={pins} route={route} center={position??current?.route?.pickup} mapLabel="Taxi Ai driver map"
    top={<View style={look.topRow}><View style={[look.status,status==='ONLINE'&&look.online]}><View style={[look.dot,status==='ONLINE'&&look.dotOnline]}/><Text style={look.statusText}>{status}</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel="Open driver account" style={look.account} onPress={()=>router.push('/account')}><Text style={look.accountText}>{user?.name?.slice(0,1).toUpperCase()??'D'}</Text></Pressable></View>}
    floating={<Pressable accessibilityRole="button" accessibilityLabel="Centre driver map on my location" accessibilityState={{busy:location.busy}} style={look.locate} onPress={()=>void location.locate()}><Text style={look.locateText}>{location.busy?'…':'⌖'}</Text></Pressable>}>
    <Pill>DRIVER</Pill><Heading title={online?'You’re online.':'Ready when you are.'} subtitle={online?'Nearby requests will appear here.':'Go online when you are ready to drive or deliver.'}/><Notice message={s.error||location.error}/>
    {!user?.driver?<Card><Text style={styles.h2}>Drive or deliver with Taxi Ai.</Text><Text style={styles.body}>Complete your Driver profile before going online.</Text><Button title="Start driver application" onPress={()=>router.push('/driver-application')}/></Card>:<>
      <Card><Pill>{status}</Pill><Text style={styles.body}>{eligible?'Your approved profile can receive matching ride and delivery requests.':'Complete your application and approval before taking new jobs.'}</Text>
        <Text style={styles.small}>Your precise work location is used for matching while online. It is not shown as an availability pin to customers.</Text>
        {online?<Button title="Go offline" secondary disabled={s.busy||s.uncertain} onPress={()=>void c.offline()}/>:<Button title="Go online with my location" busy={s.busy} disabled={!eligible||locked||Boolean(s.work?.current.length)||Boolean(s.work?.activeElsewhere.length)} onPress={()=>void c.online()}/>}
        {s.work?.settings.allowSimulation&&!online&&<><SelectField label="Local sample area" value={area} onChange={setArea} disabled={locked} options={s.work.areas.map((a)=>({value:a.id,label:a.name}))}/><Button title="Go online in sample area" secondary disabled={!eligible||locked||!area||Boolean(s.work.current.length)||Boolean(s.work.activeElsewhere.length)} onPress={()=>void c.online(area)}/></>}
        {s.uncertain&&<Button title="Retry the same work action" busy={s.busy} onPress={()=>void c.retry()}/>}<Button title="Refresh requests" secondary busy={s.loading} disabled={s.busy} onPress={()=>void c.refresh()}/>
      </Card>
      {s.work?.activeElsewhere.map((j)=><Card key={j.id}><Pill>PERSONAL JOURNEY</Pill><Text style={styles.body}>Finish your active customer journey before accepting work.</Text><Button title="View personal journey" onPress={()=>router.push({pathname:'/journey',params:{id:j.id}})}/></Card>)}
      {s.work?.current.map((j)=><Card key={j.id}><Pill>{j.delivery?'CURRENT PARCEL DELIVERY':'CURRENT JOB'}</Pill><Text style={styles.h2}>{j.pickup} → {j.destination}</Text><PassengerSummary passenger={j.passenger} bookedBy={j.customerName}/><Button title="Open active journey" onPress={()=>router.push({pathname:'/journey',params:{id:j.id}})}/></Card>)}
      <View style={look.sectionHeading}><Text style={styles.h2}>{timedOffers?'Ride offers':'Nearby requests'}</Text><Text style={styles.small}>{online?(timedOffers?'Timed offers are matched using pickup ETA, availability and waiting priority.':'Eligible requests are ordered by pickup distance and customer waiting time.'):'Go online to receive work.'}</Text></View>
      {online&&!s.work?.available.length&&<Card><Text style={styles.body}>Looking for nearby requests…</Text><Text style={styles.small}>This screen refreshes while the app is open.</Text></Card>}
      {online&&s.work?.available.map((job)=><Card key={job.id}><Pill>{`${job.service==='delivery'?'PARCEL · ':''}${vehicleCategory(job.vehicleCategory)?.name.toUpperCase()??'REQUEST'}`}</Pill>
        <Text style={styles.h2}>{job.pickup} → {job.destination}</Text><Text style={look.fare}>Suggested fare · {fare(job.suggestedFareKobo)}</Text>
        {job.offer?.etaSource==='road'&&<Text style={styles.body}>About {job.offer.pickupEtaMinutes} min to pickup · road estimate</Text>}
        {job.offer?.etaSource==='distance_fallback'&&<Text style={styles.small}>Road ETA unavailable · distance fallback</Text>}
        {(job.offer?.etaSource==='sample'||!job.offer&&s.availability?.mode==='sample')&&<Text style={styles.small}>Local sample-area match · no road ETA</Text>}
        {job.approximateDistanceKm!==null&&job.offer?.etaSource!=='road'&&<Text style={styles.small}>Within about {Math.max(1,job.approximateDistanceKm)} km straight-line distance</Text>}
        {!job.offer&&job.recommendation&&<Text style={styles.small}>{job.recommendation.reasons.map((reason)=>MATCH_REASON_LABELS[reason]).join(' · ')}</Text>}
        {job.offer&&<Text style={styles.body}>{s.now<Math.min(job.expiresAt,job.offer.expiresAt)?`Respond within ${Math.ceil((Math.min(job.expiresAt,job.offer.expiresAt)-s.now)/1000)} seconds.`:'Offer expired. Waiting for the next request.'}</Text>}
        <Text style={styles.small}>Accepting opens fare negotiation. The customer and driver must agree the exact fare before booking.</Text>
        <Button title={job.offer?'Accept & negotiate':'Take request & negotiate'} disabled={locked||s.now>=Math.min(job.expiresAt,job.offer?.expiresAt??job.expiresAt)} onPress={()=>void c.claim(job)}/>
        {job.offer&&<Button title="Decline offer" secondary disabled={locked||s.now>=Math.min(job.expiresAt,job.offer.expiresAt)} onPress={()=>void c.decline(job)}/>}</Card>)}
      <View style={look.tools}><Button title="Earnings" secondary onPress={()=>router.push('/earnings')}/><Button title="Food deliveries" secondary onPress={()=>router.push('/food-work')}/></View>
      <WorkProfileControls/>
    </>}
  </MapScaffold>;
}
const look=StyleSheet.create({
  topRow:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},status:{flexDirection:'row',alignItems:'center',gap:8,backgroundColor:'rgba(255,255,255,.95)',borderRadius:18,paddingHorizontal:14,paddingVertical:10,
    shadowColor:'#000',shadowOpacity:.08,shadowRadius:10,shadowOffset:{width:0,height:4},elevation:4},online:{backgroundColor:'#e8f2e8'},dot:{width:9,height:9,borderRadius:5,backgroundColor:'#8b938c'},dotOnline:{backgroundColor:'#2b7142'},statusText:{fontSize:12,fontWeight:'800',color:colors.ink,letterSpacing:.5},
  account:{width:46,height:46,borderRadius:23,backgroundColor:colors.ink,borderWidth:3,borderColor:colors.white,alignItems:'center',justifyContent:'center'},accountText:{color:colors.white,fontSize:17,fontWeight:'800'},
  locate:{width:48,height:48,borderRadius:24,backgroundColor:colors.white,alignItems:'center',justifyContent:'center',shadowColor:'#000',shadowOpacity:.14,shadowRadius:10,shadowOffset:{width:0,height:4},elevation:5},locateText:{fontSize:25,color:colors.ink,fontWeight:'700'},
  sectionHeading:{gap:5,marginTop:4},fare:{fontSize:18,fontWeight:'800',color:colors.ink},tools:{flexDirection:'row',gap:10},
});
