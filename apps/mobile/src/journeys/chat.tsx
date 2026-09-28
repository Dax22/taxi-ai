import { useState } from 'react';
import { Text } from '../ui/typography';
import type { JourneyController, JourneyState } from './controller';
import { Button, Card, Field, styles } from '../ui/components';
import { SelectField } from '../ui/select-field';
import { chatSafetyHints, CHAT_SAFETY_NOTICE } from '../../../../packages/shared/src/chat-safety.mjs';
export function JourneyChat({state:s,controller:c}:{state:JourneyState;controller:JourneyController}){
  const [reported,setReported]=useState<string|null>(null),[reason,setReason]=useState('');
  const locked=s.busy||s.uncertain||s.stale;
  if(!s.ride?.chatReady)return null;
  return <Card><Text accessibilityRole="header" style={styles.h2}>{s.ride.passenger?.kind==='guest'?'Booking conversation':'Conversation'}</Text><Text style={styles.small}>Discuss the fare here first. Then use the exact fare offer controls to record the price you both agree to. A chat message by itself never confirms a fare.</Text>
    {s.ride.passenger?.kind==='guest'&&<Text style={styles.small}>This chat connects the person who booked and the driver. The passenger’s trip link does not include chat.</Text>}
    <Text style={styles.small}>{CHAT_SAFETY_NOTICE}</Text>
    {s.messages.map((m)=><Card key={m.id}><Text style={styles.label}>{m.fromYou?'YOU':s.ride?.mode==='customer'?'DRIVER':s.ride?.passenger?.kind==='guest'?'BOOKED BY':'CUSTOMER'}</Text><Text selectable style={styles.body}>{m.body}</Text><Text style={styles.small}>{new Date(m.createdAt).toLocaleTimeString()}</Text>
      {!m.fromYou&&chatSafetyHints(m.body).map((hint)=><Text key={hint.kind} style={{...styles.body,backgroundColor:'#fff4cf',color:'#523c00',padding:12,borderRadius:8}}>Safety hint · {hint.message}</Text>)}
      {!m.fromYou&&(s.thread?.reportedMessageIds.includes(m.id)?<Text style={styles.small}>Report submitted</Text>:<Button title="Report message" secondary disabled={locked} onPress={()=>{setReported(m.id);setReason('');}}/>)}
    </Card>)}
    {s.thread?.hasMore&&<Button title="Load more messages" secondary disabled={locked||s.loading} onPress={()=>void c.refresh()}/>}
    {Boolean(s.thread?.unread)&&<Button title="Mark displayed messages as read" secondary disabled={locked} onPress={()=>void c.markRead()}/>}
    {reported&&<><SelectField label="Reason for reporting" value={reason} onChange={setReason} disabled={locked} options={[{value:'harassment',label:'Harassment'},{value:'unsafe_request',label:'Unsafe request'},{value:'spam',label:'Spam'},{value:'other',label:'Other'}]}/>
      <Button title="Submit report" disabled={locked||!reason} onPress={()=>{void c.report(reported,reason);setReported(null);}}/><Button title="Close report" secondary onPress={()=>setReported(null)}/></>}
    {s.thread?.canSend?<><Field label="Message" value={s.draft} onChangeText={(v)=>c.edit('draft',v)} multiline maxLength={2000} editable={!locked}/><Button title="Send message" disabled={locked||!s.draft.trim()} onPress={()=>void c.send()}/></>:<Text style={styles.small}>This conversation is read-only.</Text>}
  </Card>;
}
