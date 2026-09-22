import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Alert, Image } from 'react-native';
import { Text } from '../ui/typography';
import { router, useFocusEffect } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { useSession } from '../session/provider';
import { Button, Card, Notice, styles } from '../ui/components';
import { chooseVehiclePhoto } from './photo';
import { createVehicleCheckController } from '../../../../packages/shared/src/vehicle-check-controller.mjs';
import { CHECK_FIELDS, CHECK_GUIDANCE, CHECK_LABELS, PHOTO_CHECK_NOTICE } from '../../../../packages/shared/src/vehicle-checks.mjs';
import type { VehiclePhoto } from '../../../../packages/shared/src/vehicle-checks.mjs';

export function VehiclePhotoCheck({rideId}:{rideId:string}) {
  const {client,user,blocked}=useSession();
  const controller=useMemo(()=>createVehicleCheckController({rideId,makeKey:randomUUID,api:{
    load:id=>client.vehicleChecks(id),submit:(id,data,key)=>client.checkVehicle(id,data,key),
  }}),[rideId,client,user?.id]);
  const s=useSyncExternalStore(controller.subscribe,controller.snapshot);
  const [photo,setPhoto]=useState<VehiclePhoto|null>(null),[choosing,setChoosing]=useState(false),[error,setError]=useState('');
  const alive=useRef(false),selection=useRef(0);
  useFocusEffect(useCallback(()=>{alive.current=true;return()=>{alive.current=false;selection.current++;setPhoto(null);setChoosing(false);setError('');};},[controller]));
  useFocusEffect(useCallback(()=>{if(blocked)return;void controller.activate();const poll=setInterval(()=>void controller.load(true),5000);
    return()=>{clearInterval(poll);controller.pause();};},[controller,blocked]));
  async function choose(camera:boolean){
    if(choosing||s.pending||blocked)return;
    const epoch=++selection.current,owner=user?.id;setChoosing(true);setError('');setPhoto(null);
    try{const value=await chooseVehiclePhoto(camera);if(alive.current&&selection.current===epoch&&client.account()?.id===owner)setPhoto(value);}
    catch(e){if(alive.current&&selection.current===epoch)setError(e instanceof Error?e.message:'Could not open photo selection.');}
    finally{if(alive.current&&selection.current===epoch)setChoosing(false);}
  }
  const latest=s.value?.checks[0],locked=blocked||choosing||s.pending||!s.value?.canCheck||s.value.checks.some(c=>c.outcome==='pending');
  function analyse(){if(!photo||locked)return;const selected=photo,owner=user?.id,epoch=selection.current;
    Alert.alert('Check this vehicle photo?',PHOTO_CHECK_NOTICE,[{text:'Back',style:'cancel'},{text:'Send photo and check',onPress:()=>{
      if(alive.current&&selection.current===epoch&&client.account()?.id===owner){setPhoto(null);void controller.analyse(selected);}
    }}]);}
  return <Card><Text style={styles.h2}>AI vehicle photo check</Text>
    <Text style={styles.body}>Take a clear photo of one vehicle with its whole number plate visible. This optional check compares the photo with your assigned vehicle.</Text>
    <Notice message={error||s.error}/>
    {s.value&&!s.value.enabled&&<Text style={styles.body}>Photo checks are not enabled yet. Compare the physical plate, model and colour yourself.</Text>}
    {s.value?.enabled&&<><Button title="Take vehicle photo" secondary disabled={locked} onPress={()=>void choose(true)}/>
      <Button title="Choose vehicle photo" secondary disabled={locked} onPress={()=>void choose(false)}/>
      {photo&&<><Image accessibilityLabel="Selected vehicle photo" source={{uri:`data:${photo.mimeType};base64,${photo.base64}`}} resizeMode="contain" style={{height:180,width:'100%'}}/>
        <Button title="Analyse vehicle photo" disabled={locked} onPress={analyse}/><Button title="Clear photo" secondary onPress={()=>setPhoto(null)}/></>}
      {s.pending&&<Text accessibilityLiveRegion="polite" style={styles.body}>Checking the photo…</Text>}</>}
    <Button title="Refresh check result" secondary disabled={s.pending||blocked} busy={s.loading} onPress={()=>void controller.load()}/>
    {latest&&<><Text accessibilityLiveRegion="polite" style={styles.h2}>{CHECK_LABELS[latest.outcome]}</Text><Text style={styles.small}>Checked {new Date(latest.createdAt).toLocaleString()}{!latest.current?' · Historical result; check the current pickup yourself.':''}</Text>
      <Text style={styles.body}>{CHECK_GUIDANCE[latest.outcome]}</Text>
      {latest.fields.map(f=><Text key={f.key} style={styles.body}>{CHECK_FIELDS[f.key]}: expected {f.expected} · photo {f.observed} · {f.status==='different'?'differs':f.status==='match'?'appears to match':'not confirmed'}</Text>)}
      {['possible_match','possible_mismatch','inconclusive'].includes(latest.outcome)&&<Button title="Report concern with this result" secondary disabled={blocked||s.pending} onPress={()=>router.push({pathname:'/safety',params:{id:rideId,concern:'vehicle_mismatch',vehicleCheckId:latest.id}})}/>}</>}
    <Text style={styles.small}>AI can misread photos. This does not detect a cloned plate, prove when a photo was taken, identify the driver or authorise boarding. Reports require your confirmation.</Text>
  </Card>;
}
