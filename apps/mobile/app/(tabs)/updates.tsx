import { useCallback, useEffect, useRef, useState } from 'react';
import { Text } from '../../src/ui/typography';
import { router } from 'expo-router';
import { useSession } from '../../src/session/provider';
import { useOperations } from '../../src/journeys/provider';
import { useResource } from '../../src/ui/use-resource';
import { notificationToken } from '../../src/notifications/push';
import { DeliveryInbox } from '../../src/notifications/delivery-updates';
import { Button, Card, Heading, Notice, Pill, Screen, styles } from '../../src/ui/components';
import type { Notification } from '../../../../packages/shared/src/mobile-journeys.mjs';
export default function Updates(){
  const {client,user,mode}=useSession(),ops=useOperations();
  const resource=useResource(useCallback(()=>client.notifications(),[client]));
  const [more,setMore]=useState<Notification[]>([]),[cursor,setCursor]=useState<number|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const generation=useRef(0);
  useEffect(()=>{setMore([]);setCursor(resource.value?.nextBefore??null);},[resource.value]);
  useEffect(()=>()=>{generation.current++;},[]);
  async function run(job:()=>Promise<void>){if(busy)return;const g=generation.current;setBusy(true);setError('');try{await job();}catch(e){if(g===generation.current)setError(e instanceof Error?e.message:'Unable to load this update.');}finally{if(g===generation.current)setBusy(false);}}
  async function open(id:number){await run(async()=>{
    const g=generation.current,result=await client.openNotification(id);if(g!==generation.current)return;
    if(result.target.mode!==mode){setError('This update belongs to a different app experience. Open it on the website.');return;}
    ops.dismissPush();void ops.refreshUpdates();
    if(result.target.screen==='work')router.push('/work');else router.push({pathname:'/journey',params:{id:result.target.rideId}});
  });}
  const pushedAnnouncement=resource.value?.announcements.find((item)=>item.id===ops.announcementPushId);
  return <Screen><Heading title="Your updates." subtitle="Kemmy delivery alerts, Taxi Ai announcements, fare offers, messages and journey progress."/><Notice message={error||resource.error}/>
    <Button title="Refresh updates" secondary busy={resource.busy} disabled={busy} onPress={()=>{resource.reload();void ops.refreshUpdates();}}/>
    <DeliveryInbox/>
    {ops.pushId&&<Card><Text style={styles.body}>You opened a phone alert. Check whether it is still available for this account.</Text><Button title="Review phone alert" disabled={busy} onPress={()=>void open(ops.pushId!)}/><Button title="Dismiss phone alert" secondary onPress={ops.dismissPush}/></Card>}
    {ops.announcementPushId&&<Card><Pill>ANNOUNCEMENT</Pill><Text style={styles.h2}>{pushedAnnouncement?.title??'Taxi Ai announcement'}</Text>
      <Text style={styles.body}>{pushedAnnouncement?.body??'Open your Updates inbox to review the current announcement.'}</Text>
      {pushedAnnouncement?.readAt===null&&<Button title="Mark as read" disabled={busy} onPress={()=>void run(async()=>{await client.readAnnouncement(ops.announcementPushId!);ops.dismissAnnouncementPush();resource.reload();void ops.refreshUpdates();})}/>}
      <Button title="Dismiss phone alert" secondary onPress={ops.dismissAnnouncementPush}/></Card>}
    {resource.value&&<>{resource.value.announcements.map((item)=><Card key={'announcement-'+item.id}><Pill>{`ANNOUNCEMENT · ${item.priority.toUpperCase()}${item.readAt===null?' · NEW':''}`}</Pill>
      <Text style={styles.h2}>{item.title}</Text><Text style={styles.body}>{item.body}</Text>
      <Text style={styles.small}>{`Published ${new Date(item.publishedAt).toLocaleString()} · visible until ${new Date(item.expiresAt).toLocaleString()}`}</Text>
      {item.readAt===null&&<Button title="Mark as read" secondary disabled={busy} onPress={()=>void run(async()=>{await client.readAnnouncement(item.id);resource.reload();void ops.refreshUpdates();})}/>}</Card>)}
    <Card><Text style={styles.h2}>Phone alerts</Text><Text style={styles.body}>{resource.value.push.registered?'Alerts are enabled for this signed-in device.':'Your updates are always available here. Phone alerts are optional.'}</Text>
      <Text style={styles.small}>Alerts include journey and Kemmy delivery progress. Arrival alerts include the driver’s name and vehicle details. These may appear on your lock screen; use your phone’s notification-preview settings to hide them.</Text>
      {resource.value.push.enabled?<Button title={resource.value.push.registered?'Disable phone alerts':'Enable phone alerts'} busy={busy} onPress={()=>void run(async()=>{
        const g=generation.current,actor=user?.id;
        if(resource.value!.push.registered)await client.disablePush();else{
          const project=resource.value!.push.projectId!,token=await notificationToken(project);
          if(g!==generation.current||client.account()?.id!==actor)return;
          await client.registerPush(token,project);
        }if(g===generation.current){resource.reload();void ops.refreshUpdates();}
      })}/>:<Text style={styles.small}>Phone alerts are not enabled on this server. Check this inbox for updates.</Text>}
    </Card>
    {[...resource.value.notifications,...more].filter((n,i,all)=>n.mode===mode&&all.findIndex((v)=>v.id===n.id)===i).map((n)=><Card key={n.id}><Pill>{`${mode==='work'?'DRIVER':'CUSTOMER'}${n.readAt===null?' · NEW':''}`}</Pill><Text style={styles.h2}>{n.title}</Text>{n.body&&<><Text style={styles.body}>{n.body}</Text><Text style={styles.small}>Recorded arrival update. Open the journey for its current status.</Text></>}<Text style={styles.small}>{new Date(n.createdAt).toLocaleString()}</Text><Button title={n.kind==='request'?'Review available requests':'View journey'} disabled={busy} onPress={()=>void open(n.id)}/>
      {n.readAt===null&&<Button title="Mark as read" secondary disabled={busy} onPress={()=>void run(async()=>{await client.readNotification(n.id);resource.reload();void ops.refreshUpdates();})}/>}</Card>)}
    {!resource.value.notifications.some((n)=>n.mode===mode)&&resource.value.announcements.length===0&&<Text style={styles.body}>No other announcements or journey updates.</Text>}
    {cursor&&<Button title="Load older updates" secondary busy={busy} onPress={()=>void run(async()=>{const g=generation.current,page=await client.notifications(cursor);if(g===generation.current){setMore((old)=>[...old,...page.notifications]);setCursor(page.nextBefore);}})}/>}
    </>}
  </Screen>;
}
