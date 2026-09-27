import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../ui/typography';
import { Button, colors, styles as uiStyles } from '../ui/components';
import { useSession } from '../session/provider';
import { notificationToken } from '../notifications/push';
import type { KemmySetup } from './contracts';

export function KemmySetupAssistant() {
  const { client, user, role, chooseRole } = useSession();
  const insets = useSafeAreaInsets();
  const [setup,setSetup]=useState<KemmySetup|null>(null),[visible,setVisible]=useState(false),[launcher,setLauncher]=useState(false);
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const generation=useRef(0);

  useEffect(()=>{
    const epoch=++generation.current;
    setSetup(null);setVisible(false);setLauncher(false);setNotice('');
    if(!user)return;
    const timer=setTimeout(()=>{void client.kemmySetup().then((next)=>{
      if(epoch!==generation.current)return;setSetup(next);
      if(next.autoOpen)setVisible(true);else setLauncher(true);
    }).catch(()=>{});},3000);
    return()=>{clearTimeout(timer);};
  },[client,user?.id]);

  async function update(action:string,value?:string){
    if(!user||busy)return null;
    const epoch=generation.current;setBusy(true);setNotice('');
    try{
      const next=await client.updateKemmySetup(action,value);
      if(epoch!==generation.current)return null;
      setSetup(next);setVisible(true);setLauncher(false);return next;
    }catch(error){
      if(epoch===generation.current)setNotice(error instanceof Error?error.message:'Kemmy could not update setup.');
      return null;
    }finally{if(epoch===generation.current)setBusy(false);}
  }

  async function dismiss(){
    if(await update('dismiss')){setVisible(false);setLauncher(true);}
  }
  async function chooseExperience(value:'customer'|'driver'|'eats_seller'){
    const next=await update('experience',value);if(!next)return;
    if(!role)await chooseRole(value==='driver'?'driver':'customer');
    if(value==='eats_seller')router.push('/my-store');
  }
  async function enableAlerts(){
    if(busy)return;setBusy(true);setNotice('');
    const epoch=generation.current;
    try{
      const news=await client.notifications();
      if(!news.push.enabled||!news.push.projectId){
        const next=await client.updateKemmySetup('notifications','in_app');
        if(epoch===generation.current){setSetup(next);setVisible(true);}
        return;
      }
      if(!news.push.registered){
        const token=await notificationToken(news.push.projectId);
        await client.registerPush(token,news.push.projectId);
      }
      const next=await client.updateKemmySetup('notifications','enabled');
      if(epoch===generation.current){setSetup(next);setVisible(true);}
    }catch(error){if(epoch===generation.current)setNotice(error instanceof Error?error.message:'Phone alerts could not be enabled.');}
    finally{if(epoch===generation.current)setBusy(false);}
  }
  async function sendVerification(){
    if(busy)return;setBusy(true);setNotice('');
    try{await client.requestVerification();setNotice('Verification email requested. Open the latest Taxi Ai email to finish verification.');}
    catch(error){setNotice(error instanceof Error?error.message:'Verification email is unavailable.');}
    finally{setBusy(false);}
  }

  if(!user)return null;
  if(!visible)return launcher?<Pressable accessibilityRole="button" accessibilityLabel="Open Kemmy assistant" onPress={()=>void update('resume')}
    style={[sheet.launcher,{bottom:Math.max(16,insets.bottom+8)}]}><View style={sheet.avatar}><Text style={sheet.avatarText}>K</Text></View><Text style={sheet.launcherText}>Kemmy</Text></Pressable>:null;
  if(!setup)return null;

  let title='Hi, my name is Kemmy.';
  let body='I’m your Taxi Ai assistant. I can help you set up your account.';
  let actions=<><Button title="Set up my account" busy={busy} onPress={()=>void update('start')}/><Button title="Maybe later" secondary disabled={busy} onPress={()=>void dismiss()}/></>;

  if(setup.nextStep==='email'){
    title='Protect your account.';
    body=setup.emailVerified?'Your email is verified.':'Verify your email so password recovery and account notices can reach you.';
    actions=<><Button title="Send verification email" busy={busy} onPress={()=>void sendVerification()}/><Button title="Continue for now" secondary disabled={busy} onPress={()=>void update('email-later')}/></>;
  } else if(setup.nextStep==='experience'){
    title='How will you use Taxi Ai?';
    body='Choose where you want to start. This does not lock your account into one service.';
    actions=<><Button title="Book rides & deliveries" busy={busy} onPress={()=>void chooseExperience('customer')}/><Button title="Drive & deliver" secondary disabled={busy} onPress={()=>void chooseExperience('driver')}/><Button title="Sell food" secondary disabled={busy} onPress={()=>void chooseExperience('eats_seller')}/></>;
  } else if(setup.nextStep==='notifications'){
    title='Stay up to date.';
    body='Your Updates inbox always works. You can also enable phone alerts on supported builds.';
    actions=<><Button title="Enable phone alerts" busy={busy} onPress={()=>void enableAlerts()}/><Button title="Use in-app updates only" secondary disabled={busy} onPress={()=>void update('notifications','in_app')}/><Button title="Decide later" secondary disabled={busy} onPress={()=>void update('notifications','later')}/></>;
  } else if(setup.nextStep==='safety'){
    title='Set up Family Safety.';
    body='Trusted contacts are optional. You can review them now or come back later.';
    actions=<><Button title="Open Family Safety" busy={busy} onPress={()=>void update('safety','review').then((next)=>{if(next)router.push('/family');})}/><Button title="Do this later" secondary disabled={busy} onPress={()=>void update('safety','later')}/></>;
  } else if(setup.nextStep==='finish'){
    title='You’re ready to use Taxi Ai.';
    body='Kemmy can still help you find the right place for rides, Eats, Courier and account setup.';
    actions=<Button title="Finish setup" busy={busy} onPress={()=>void update('complete')}/>;
  } else if(setup.nextStep==='complete'){
    title='How can I help?';
    body='Your account setup is complete. Choose where you want to go.';
    actions=<><Button title="Book a ride" onPress={()=>{setVisible(false);setLauncher(true);router.push('/book-ride');}}/><Button title="Open Taxi Ai Eats" secondary onPress={()=>{setVisible(false);setLauncher(true);router.push('/eats');}}/><Button title="Send a parcel" secondary onPress={()=>{setVisible(false);setLauncher(true);router.push({pathname:'/book-ride',params:{category:'motorcycle',service:'courier'}});}}/><Button title="Review setup again" secondary busy={busy} onPress={()=>void update('restart')}/></>;
  }

  return <View style={[sheet.scrim,{paddingBottom:Math.max(12,insets.bottom)}]} pointerEvents="box-none">
    <View style={sheet.card} accessibilityViewIsModal accessibilityLabel="Kemmy account assistant">
      <View style={sheet.top}><View style={sheet.avatar}><Text style={sheet.avatarText}>K</Text></View><View style={{flex:1}}><Text style={sheet.name}>Kemmy</Text><Text style={sheet.role}>Your Taxi Ai assistant</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Close Kemmy" onPress={()=>void dismiss()} style={sheet.close}><Text style={sheet.closeText}>×</Text></Pressable></View>
      <Text style={uiStyles.h2}>{title}</Text><Text style={uiStyles.body}>{body}</Text>
      {notice?<Text style={sheet.notice}>{notice}</Text>:null}
      <View style={sheet.actions}>{actions}</View>
      <Text style={uiStyles.small}>Guided setup uses fixed Taxi Ai rules and does not use an AI language model.</Text>
    </View>
  </View>;
}
const sheet=StyleSheet.create({
  scrim:{position:'absolute',left:0,right:0,bottom:0,zIndex:90,padding:12,alignItems:'center'},
  card:{width:'100%',maxWidth:520,backgroundColor:'#fff9e7',borderColor:'#efc84d',borderWidth:1,borderRadius:24,padding:20,gap:12,shadowColor:'#000',shadowOpacity:.18,shadowRadius:24,shadowOffset:{width:0,height:8},elevation:12},
  top:{flexDirection:'row',alignItems:'center',gap:12},avatar:{width:44,height:44,borderRadius:22,backgroundColor:colors.yellow,alignItems:'center',justifyContent:'center'},
  avatarText:{fontSize:22,fontWeight:'800',color:colors.ink},name:{fontSize:17,fontWeight:'800',color:colors.ink},role:{fontSize:12,color:colors.muted},
  close:{width:44,height:44,alignItems:'center',justifyContent:'center'},closeText:{fontSize:30,color:colors.ink},actions:{gap:8,marginTop:4},
  notice:{fontSize:13,lineHeight:19,color:colors.ink,backgroundColor:'#fff0bd',padding:10,borderRadius:10},
  launcher:{position:'absolute',right:16,zIndex:89,flexDirection:'row',alignItems:'center',gap:8,minHeight:54,paddingVertical:5,paddingLeft:5,paddingRight:14,borderRadius:28,borderWidth:1,borderColor:'#efc84d',backgroundColor:'#fff9e7',shadowColor:'#000',shadowOpacity:.16,shadowRadius:16,shadowOffset:{width:0,height:6},elevation:10},
  launcherText:{fontSize:14,fontWeight:'800',color:colors.ink},
});
