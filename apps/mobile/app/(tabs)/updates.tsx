import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { Text } from '../../src/ui/typography';
import { router } from 'expo-router';
import { useSession } from '../../src/session/provider';
import { useOperations } from '../../src/journeys/provider';
import { useResource } from '../../src/ui/use-resource';
import { notificationToken } from '../../src/notifications/push';
import { Button, Card, Heading, Notice, Pill, Screen, styles } from '../../src/ui/components';
import type { Notification } from '../../../../packages/shared/src/mobile-journeys.mjs';
export default function Updates(){
  const {client,user,mode,setMode}=useSession(),ops=useOperations();
  const resource=useResource(useCallback(()=>client.notifications(),[client]));
  const [more,setMore]=useState<Notification[]>([]),[cursor,setCursor]=useState<number|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const generation=useRef(0);
  useEffect(()=>{setMore([]);setCursor(resource.value?.nextBefore??null);},[resource.value]);
  useEffect(()=>()=>{generation.current++;},[]);
  async function run(job:()=>Promise<void>){if(busy)return;const g=generation.current;setBusy(true);setError('');try{await job();}catch(e){if(g===generation.current)setError(e instanceof Error?e.message:'Unable to load this update.');}finally{if(g===generation.current)setBusy(false);}}
  async function open(id:number){await run(async()=>{
    const g=generation.current,result=await client.openNotification(id);if(g!==generation.current)return;
    if(result.target.mode!==mode){const consent=await new Promise<boolean>((resolve)=>Alert.alert('Open this update?',`This journey belongs to ${result.target.mode==='work'?'Work':'Customer'}.`,[{text:'Stay here',style:'cancel',onPress:()=>resolve(false)},{text:'Open journey',onPress:()=>resolve(true)}],{cancelable:false}));if(!consent||g!==generation.current)return;}
    if(!await setMode(result.target.mode)||g!==generation.current)return;
    ops.dismissPush();void ops.refreshUpdates();
    if(result.target.screen==='work')router.push('/work');else router.push({pathname:'/journey',params:{id:result.target.rideId}});
  });}
  return <Screen><Heading title="Your updates." subtitle="Requests, fare offers, messages and journey progress."/><Notice message={error||resource.error}/>
    <Button title="Refresh updates" secondary busy={resource.busy} disabled={busy} onPress={()=>{resource.reload();void ops.refreshUpdates();}}/>
    {ops.pushId&&<Card><Text style={styles.body}>You opened a phone alert. Check whether it is still available for this account.</Text><Button title="Review phone alert" disabled={busy} onPress={()=>void open(ops.pushId!)}/><Button title="Dismiss phone alert" secondary onPress={ops.dismissPush}/></Card>}
    {resource.value&&<><Card><Text style={styles.h2}>Phone alerts</Text><Text style={styles.body}>{resource.value.push.registered?'Alerts are enabled for this signed-in device.':'Your updates are always available here. Phone alerts are optional.'}</Text>
      <Text style={styles.small}>Arrival alerts include the driver’s name, vehicle type, colour and number plate. These details may appear on your lock screen; use your phone’s notification-preview settings to hide them.</Text>
      {resource.value.push.enabled?<Button title={resource.value.push.registered?'Disable phone alerts':'Enable phone alerts'} busy={busy} onPress={()=>void run(async()=>{
        const g=generation.current,actor=user?.id;
        if(resource.value!.push.registered)await client.disablePush();else{
          const project=resource.value!.push.projectId!,token=await notificationToken(project);
          if(g!==generation.current||client.account()?.id!==actor)return;
          await client.registerPush(token,project);
        }if(g===generation.current){resource.reload();void ops.refreshUpdates();}
      })}/>:<Text style={styles.small}>Phone alerts are not enabled on this server. Check this inbox for updates.</Text>}
    </Card>
    {[...resource.value.notifications,...more].filter((n,i,all)=>all.findIndex((v)=>v.id===n.id)===i).map((n)=><Card key={n.id}><Pill>{`${n.mode==='work'?'WORK':'CUSTOMER'}${n.readAt===null?' · NEW':''}`}</Pill><Text style={styles.h2}>{n.title}</Text>{n.body&&<><Text style={styles.body}>{n.body}</Text><Text style={styles.small}>Recorded arrival update. Open the journey for its current status.</Text></>}<Text style={styles.small}>{new Date(n.createdAt).toLocaleString()}</Text><Button title={n.kind==='request'?'Review available work':'View journey'} disabled={busy} onPress={()=>void open(n.id)}/>
      {n.readAt===null&&<Button title="Mark as read" secondary disabled={busy} onPress={()=>void run(async()=>{await client.readNotification(n.id);resource.reload();void ops.refreshUpdates();})}/>}</Card>)}
    {!resource.value.notifications.length&&<Text style={styles.body}>You are all caught up. New journey updates will appear here.</Text>}
    {cursor&&<Button title="Load older updates" secondary busy={busy} onPress={()=>void run(async()=>{const g=generation.current,page=await client.notifications(cursor);if(g===generation.current){setMore((old)=>[...old,...page.notifications]);setCursor(page.nextBefore);}})}/>}
    </>}
  </Screen>;
}
