import { useEffect, useRef, useState } from 'react';
import { Switch, View, AppState } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useSession } from '../session/provider';
import { Button, Card, Field, Notice, styles } from '../ui/components';
import { Text } from '../ui/typography';
import { createMonitoringController } from '../../../../packages/shared/src/safety-monitoring-controller.mjs';
import type { MonitoringState } from '../../../../packages/shared/src/safety-monitoring-controller.mjs';
import { SAFETY_SIGNAL_LABELS } from '../../../../packages/shared/src/safety-monitoring.mjs';
import { createNativeSafetySensors } from './monitoring-sensors';
import type { Contact } from './contracts';

export function MonitoringCard({id,contacts}:{id:string;contacts:Contact[]}) {
 const {client,user,blocked}=useSession();
 const [s,set]=useState<MonitoringState>({data:null,busy:false,active:false,error:'',uncertain:false,sensorNote:'Monitoring is off.',receivedAt:0});
 const [crash,setCrash]=useState(false),[distress,setDistress]=useState(false),[emergency,setEmergency]=useState(false),[consent,setConsent]=useState(false),[selected,setSelected]=useState<string[]>([]);
 const [label,setLabel]=useState(''),[lat,setLat]=useState(''),[lng,setLng]=useState(''),[note,setNote]=useState(''),[reported,setReported]=useState(false);
 const ref=useRef<ReturnType<typeof createMonitoringController>|null>(null);
 useEffect(()=>{
  if(blocked||!user)return;
  const c=createMonitoringController({viewerId:user.id,rideId:id,read:()=>client.safetyMonitoring(id),write:(action,data,key)=>client.safetyMonitoringCommand(id,action,data,key),
   sensors:createNativeSafetySensors(),makeKey:randomUUID,onChange:set});ref.current=c;
  void c.refresh();const timer=setInterval(()=>{if(AppState.currentState==='active')void c.refresh();},3000);
  return()=>{clearInterval(timer);c.close();ref.current=null;};
 },[id,client,user?.id,blocked]);
 if(blocked||!user)return null;
 const d=s.data,locked=s.busy||s.active||s.uncertain;
 const toggle=(title:string,value:boolean,change:(value:boolean)=>void,disabled=locked)=><View style={{flexDirection:'row',alignItems:'center',gap:12,marginVertical:8}}><Switch accessibilityLabel={title} value={value} onValueChange={change} disabled={disabled}/><Text style={[styles.body,{flex:1}]}>{title}</Text></View>;
 return <Card><Text style={styles.h2}>Safety monitoring · experimental</Text>
  <Text style={styles.body}>Keep this safety screen open. Possible-crash checks use motion and speed. Loud-distress checks use sound level; they cannot identify a scream or prove panic. Phone drops, music and shouting can cause false alarms.</Text>
  <Text style={styles.small}>Microphone samples stay in memory on this phone. No audio files or recordings are uploaded. Monitoring pauses when you leave this screen or lock the phone; an alert already saved on the server can continue.</Text>
  <Text accessibilityLiveRegion="polite" style={styles.body}>{s.sensorNote}</Text>
  <Text style={styles.small}>{d?.settings.delivery==='configured'?'Delivery gateway configured. Acceptance does not confirm delivery or emergency response.':'External alerts unavailable: no delivery gateway is configured.'}</Text>
  <Notice message={s.error}/>
  {toggle('Possible-crash checks',crash,setCrash)}{toggle('Loud-distress checks',distress,setDistress)}
  <Text style={styles.h2}>Alert recipients</Text>
  {contacts.map(c=><View key={c.id}>{toggle(`${c.name} · ${c.phone}`,selected.includes(c.id),v=>setSelected(old=>v?[...old,c.id]:old.filter(id=>id!==c.id)))}</View>)}
  {!contacts.length&&<Text style={styles.small}>Add trusted contacts in the section below first.</Text>}
  {toggle(d?.settings.emergencyService?`Emergency partner: ${d.settings.emergencyService}`:'Emergency partner unavailable',emergency,setEmergency,locked||!d?.settings.emergencyService)}
  {toggle('I agree to share passenger name/ID, driver name/ID, vehicle details and available trip location with selected recipients if a 30-second alert countdown expires.',consent,setConsent)}
  <Button title="Start monitoring" disabled={locked||!d?.canMonitor||!consent||Boolean(d?.alerts.some(a=>['countdown','queued'].includes(a.status)))} onPress={()=>void ref.current?.start({crash,distress,emergency,contactIds:selected.filter(id=>contacts.some(c=>c.id===id)),consent})}/>
  <Button title="Stop monitoring and cancel unsent alerts" secondary disabled={s.busy||s.uncertain||!d} onPress={()=>void ref.current?.stop()}/>
  <Button title="Start panic alert countdown" disabled={!s.active||s.busy||s.uncertain} onPress={()=>void ref.current?.panic()}/>
  {s.uncertain&&<Button title="Retry the same action" disabled={s.busy} onPress={()=>void ref.current?.retry()}/>}
  {(d?.alerts??[]).map(a=><Card key={a.id}><Text style={styles.h2}>{SAFETY_SIGNAL_LABELS[a.kind]}</Text><Text accessibilityLiveRegion="polite" style={styles.body}>{a.status==='countdown'?`Countdown: ${Math.max(0,Math.ceil((a.dueAt-d!.serverNow-Date.now()+s.receivedAt)/1000))} seconds`:a.status}</Text>
   {['countdown','queued'].includes(a.status)&&<Button title="I am safe — cancel unsent alert" disabled={s.busy||s.uncertain} onPress={()=>void ref.current?.cancel(a)}/>}
   {a.deliveries.map(j=><Text key={j.id} style={styles.small}>{j.name}: {j.status==='accepted'?'Accepted by gateway; delivery and response unconfirmed':j.status}</Text>)}
   <Text style={styles.small}>Cancelling cannot recall a message already handed to a provider.</Text>
  </Card>)}
  <Text style={styles.h2}>Reviewed location warnings</Text><Text style={styles.small}>{d?.coverage}</Text>
  {(d?.warnings??[]).map(z=><Text key={z.id} style={styles.body}>{z.label} · {z.radiusM} m · expires {new Date(z.expiresAt).toLocaleString()}</Text>)}
  <Text style={styles.h2}>Flag a location for review</Text><Text style={styles.small}>Your report stays private until an administrator reviews it.</Text>
  <Field label="Location name" value={label} onChangeText={setLabel} maxLength={80}/><Field label="Latitude" value={lat} onChangeText={setLat} keyboardType="numbers-and-punctuation"/><Field label="Longitude" value={lng} onChangeText={setLng} keyboardType="numbers-and-punctuation"/>
  <Field label="What concern did you observe?" value={note} onChangeText={setNote} maxLength={300}/>
  <Button title="Submit location for review" disabled={s.busy||s.uncertain||!d?.canMonitor||!lat||!lng} onPress={()=>void ref.current?.reportZone({label,lat:Number(lat),lng:Number(lng),radiusM:300,note}).then(ok=>setReported(ok))}/>
  {reported&&<Text style={styles.small}>Saved for administrator review.</Text>}
 </Card>;
}
