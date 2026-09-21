import { useEffect, useState } from 'react';
import { Alert, Share, Text } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafety } from '../src/journeys/provider';
import { useSession } from '../src/session/provider';
import { Button, Card, Field, Heading, Notice, Screen, styles } from '../src/ui/components';
import { SelectField } from '../src/ui/select-field';
import type { Contact } from '../src/safety/contracts';
import { TripLocationCard } from '../src/tracking/view';
import { vehicleMismatchReport } from '../../../packages/shared/src/pickup-identity.mjs';
const kinds=[{value:'need_help',label:'Need help / SOS'},{value:'vehicle_mismatch',label:'Vehicle or number plate does not match'},{value:'unsafe_behaviour',label:'Unsafe behaviour'},{value:'possible_crash',label:'Possible crash'},{value:'other',label:'Other concern'}];
function SafetyScreen({id,mismatch,vehicleCheckId}:{id:string;mismatch:boolean;vehicleCheckId?:string}){
 const {state:s,controller:c}=useSafety(id),{client,blocked,user}=useSession();
 const [name,setName]=useState(''),[phone,setPhone]=useState(''),[editing,setEditing]=useState<Contact|null>(null),[note,setNote]=useState(''),[kind,setKind]=useState(mismatch?'vehicle_mismatch':'need_help'),[error,setError]=useState('');
 useEffect(()=>{if(blocked){setName('');setPhone('');setNote('');setEditing(null);}},[blocked]);
 const locked=s.busy||s.uncertain||s.stale;
 const confirm=(title:string,detail:string,path:string,data:Record<string,unknown>)=>Alert.alert(title,detail,[{text:'Back',style:'cancel'},{text:title,onPress:()=>void c.command(path,data)}]);
 function report(){setError('');try{const data=kind==='vehicle_mismatch'?vehicleMismatchReport(note):{kind,note,contactIds:[]};
  confirm(kind==='vehicle_mismatch'?'Report different vehicle':'Save test incident','Save this concern and the assigned vehicle details for administrator review? This does not cancel the trip, notify emergency services or automatically penalise the driver.',`rides/${id}/incidents`,{...data,...(kind==='vehicle_mismatch'&&vehicleCheckId?{vehicleCheckId}:{})});
 }catch(e){setError(e instanceof Error?e.message:'Check your report.');}}
 async function share(){if(c.snapshot().loading||c.snapshot().uncertain)return;setError('');const owner=user?.id;await c.refresh();const latest=c.snapshot();if(client.account()?.id!==owner||latest.stale||latest.busy||latest.loading||latest.uncertain||!latest.token||!latest.trip?.share?.active||latest.trip.share.expiresAt<=latest.trip.serverNow)return;
 try{await Share.share({message:`Private Taxi Ai test-trip link. Anyone with this link and preview access can view the trip until it ends or the link expires. ${client.safetyLink(latest.token)}`});}catch{setError('Could not open sharing. The link was not confirmed sent.');}}
 return <Screen><Heading title="Trip safety" subtitle="For customers and drivers"/>
 <Card><Text style={styles.h2}>SOS and emergency help</Text><Text style={styles.body}>This preview can save an incident for administrator review. It does not call emergency services or send alerts to trusted contacts. No staffed response is promised. If you are in immediate danger, contact local emergency services directly.</Text></Card>
 <Notice message={s.error||error}/><Notice message={s.notice}/><Button title="Refresh safety details" secondary busy={s.loading} disabled={s.busy} onPress={()=>void c.refresh()}/>
 {s.uncertain&&<Button title="Retry the same safety action" busy={s.busy} onPress={()=>void c.retry()}/>}
 <Card><Text style={styles.h2}>Trusted contacts</Text><Text style={styles.small}>Up to three contacts. Numbers are unverified and notifications are unavailable. Editing or removing a contact cancels their pending test alerts.</Text>
 {s.contacts.map(contact=><Card key={contact.id}><Text style={styles.body}>{contact.name} · {contact.phone}</Text><Button title={`Edit ${contact.name}`} secondary disabled={locked} onPress={()=>{setEditing(contact);setName(contact.name);setPhone(contact.phone);}}/><Button title={`Remove ${contact.name}`} secondary disabled={locked} onPress={()=>confirm('Remove contact','Remove this saved contact?',`contacts/${contact.id}/remove`,{expectedVersion:contact.version})}/></Card>)}
 <Field label="Contact name" value={name} maxLength={80} editable={!locked} onChangeText={setName}/><Field label="Phone including country code" value={phone} maxLength={16} keyboardType="phone-pad" editable={!locked} onChangeText={setPhone}/>
 <Button title={editing?'Save contact changes':'Add trusted contact'} disabled={locked||!name.trim()||!phone.trim()||!editing&&s.contacts.length>=3} onPress={()=>{const data={name:name.trim(),phone:phone.trim(),...(editing?{expectedVersion:editing.version}:{})};void c.command(editing?`contacts/${editing.id}/edit`:'contacts',data).then(()=>{if(!c.snapshot().error){setEditing(null);setName('');setPhone('');}});}}/>
 {editing&&<Button title="Cancel editing" secondary disabled={s.busy||s.uncertain} onPress={()=>{setEditing(null);setName('');setPhone('');}}/>}</Card>
 {s.trip&&<><TripLocationCard id={id}/><Card><Text style={styles.h2}>Share this trip</Text><Text style={styles.body}>Links expire and can be revoked. Recipients need invited-tester access in staging. Sharing exposes the trip, driver and available driver-shared location to the chosen recipient. Creating a link does not start GPS; the driver chooses Share my location separately.</Text>
 {s.trip.share&&<><Text style={styles.body}>Link expires {new Date(s.trip.share.expiresAt).toLocaleString()}</Text><Button title="Revoke trip link" secondary disabled={locked} onPress={()=>confirm('Revoke link','People with this link will lose access.',`links/${s.trip!.share!.id}/revoke`,{expectedVersion:s.trip!.share!.version})}/></>}
 {[15,30,60].map(minutes=><Button key={minutes} title={`${s.trip?.share?'Replace':'Create'} ${minutes}-minute link`} secondary disabled={locked||!s.trip?.canRaise} onPress={()=>confirm('Create private link','This replaces any current link. You choose whether and where to share it.',`rides/${id}/links`,{minutes,expectedShareId:s.trip?.share?.id??null})}/>)}
 {s.token&&<Button title="Choose who to share with" disabled={locked} onPress={()=>void share()}/>}</Card>
 <Card><Text style={styles.h2}>Report a safety concern / SOS</Text><Text style={styles.small}>Saves your report and trip snapshot only. Contacts and emergency services will not be notified.</Text><SelectField label="Concern" value={kind} onChange={setKind} options={kinds} disabled={locked}/>
 {kind==='vehicle_mismatch'&&<Text style={styles.body}>Do not board, hand over a parcel or share your PIN if the plate, model or colour differs. Describe what you can safely observe. Your report goes to review; it does not automatically penalise the driver. You can cancel from the journey before pickup.</Text>}
 {kind==='vehicle_mismatch'&&vehicleCheckId&&<Text style={styles.small}>Your AI comparison result will be saved with this report for review. No photo is attached.</Text>}
 <Field label={kind==='vehicle_mismatch'?'Different plate, model or colour (optional)':'What happened? (optional)'} value={note} onChangeText={setNote} multiline maxLength={kind==='vehicle_mismatch'?480:500} editable={!locked}/>
 <Button title={kind==='vehicle_mismatch'?'Report different vehicle':'Save test incident'} disabled={locked||!s.trip.canRaise||s.trip.incidents.some(i=>i.status!=='resolved')} onPress={report}/>
 {s.trip.incidents.some(i=>i.status!=='resolved')&&<Text style={styles.small}>You already have an open report for this trip. Its reference and status are below.</Text>}
 {!s.trip.canRaise&&<Text style={styles.small}>New reports and links are available only on confirmed, active trips. Existing records remain readable.</Text>}</Card>
 <Card><Text style={styles.h2}>Your incident records</Text>{!s.trip.incidents.length&&<Text style={styles.body}>No incident records for this trip.</Text>}{s.trip.incidents.map(i=><Card key={i.id}><Text selectable style={styles.small}>Reference: {i.id}</Text><Text style={styles.h2}>{i.status==='open'?'Open test incident':i.status==='acknowledged'?'Acknowledged by test administrator':'Closed by test administrator'}</Text><Text style={styles.body}>{kinds.find(k=>k.value===i.kind)?.label} · {i.note}</Text><Text style={styles.small}>Updated {new Date(i.updatedAt).toLocaleString()}</Text><Text style={styles.small}>Real contact notification: unavailable. No emergency response requested.</Text>{i.notifications.map(n=><Text key={n.id} style={styles.small}>{n.recipientName}: simulation only · {n.status}</Text>)}</Card>)}</Card></>}
 </Screen>;
}
export default function Safety(){const {id,concern,vehicleCheckId}=useLocalSearchParams<{id:string;concern?:string;vehicleCheckId?:string}>();
 const checkId=typeof vehicleCheckId==='string'&&/^[a-f0-9-]{36}$/.test(vehicleCheckId)?vehicleCheckId:undefined;
 return typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id)?<SafetyScreen key={`${id}:${concern==='vehicle_mismatch'}:${checkId??''}`} id={id} mismatch={concern==='vehicle_mismatch'} vehicleCheckId={checkId}/>:<Screen><Notice message="Open Safety from a journey."/></Screen>;}
