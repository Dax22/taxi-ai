import { useEffect,useMemo,useSyncExternalStore } from 'react';
import { randomUUID } from 'expo-crypto';
import { Text } from '../ui/typography';
import { Button,Card,Notice,Pill,styles } from '../ui/components';
import { useSession } from '../session/provider';
import { NativeCallController } from './controller';

export function NativeCallCard({rideId}:{rideId:string}){
 const {client,user}=useSession();
 const controller=useMemo(()=>new NativeCallController(client,rideId,user?.id??'',randomUUID),[client,rideId,user?.id]);
 const state=useSyncExternalStore(controller.subscribe,controller.snapshot);
 useEffect(()=>{if(!user)return;controller.activate();return()=>controller.dispose();},[controller,user?.id]);
 if(!user)return null;
 const call=state.active,other=call?(call.caller.id===user.id?call.callee:call.caller):null;
 const another=call&&call.rideId!==rideId;
 return <Card><Pill>MASKED IN-APP AUDIO</Pill><Text style={styles.h2}>Call without sharing phone numbers</Text>
  <Notice message={state.error}/>
  {!state.loaded?<Text style={styles.small}>Checking call availability…</Text>:!state.settings?.enabled?<Text style={styles.body}>Audio calling is not available right now. In-app chat remains available.</Text>
   :another?<Text style={styles.body}>Another Taxi Ai call is active. Finish it before starting a call for this journey.</Text>
   :!call?<><Text style={styles.body}>Start a private in-app audio call with the other trip participant. Taxi Ai does not reveal either phone number.</Text><Button title="Start audio call" busy={state.busy} onPress={()=>void controller.start()}/></>
   :call.status==='ringing'&&call.callee.id===user.id?<><Text style={styles.body}>{other?.name??'Your trip contact'} is calling.</Text><Button title="Answer call" busy={state.busy} onPress={()=>void controller.answer()}/><Button title="Decline" secondary disabled={state.busy} onPress={()=>void controller.decline()}/></>
   :call.status==='ringing'?<><Text style={styles.body}>Calling {other?.name??'your trip contact'}…</Text><Button title="End call" secondary onPress={()=>void controller.end()}/></>
   :['connecting','connected'].includes(call.status)?<><Text style={styles.body}>{call.status==='connected'?'Connected':'Connecting audio…'} · {other?.name??'trip participant'}</Text><Text style={styles.small}>Connection · {state.connection}</Text><Button title={state.muted?'Unmute':'Mute'} secondary onPress={()=>controller.mute()}/><Button title="End call" onPress={()=>void controller.end()}/></>
   :<Text style={styles.small}>Last call · {call.status.replaceAll('_',' ')}</Text>}
  <Text style={styles.small}>Microphone access starts only when you tap Start or Answer. Audio is peer-to-peer through Taxi Ai’s relay and is not recorded by Taxi Ai.</Text>
 </Card>;
}
