import { pushTarget } from './push-target';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { isDevice } from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
const supported = () => isDevice && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
export async function notificationToken(projectId: string): Promise<string> {
  if(!supported())throw new Error('Phone alerts require an installed device build. Updates are available inside the app.');
  const configured=Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
  if(configured!==projectId)throw new Error('This build and the server must use the same notification project.');
  if(Platform.OS==='android')await Notifications.setNotificationChannelAsync('journeys',{name:'Journey updates',importance:Notifications.AndroidImportance.DEFAULT});
  let permission=await Notifications.getPermissionsAsync();
  if(!permission.granted)permission=await Notifications.requestPermissionsAsync();
  if(!permission.granted)throw new Error('Phone alerts are off. You can enable them in your phone settings; your updates remain in the app.');
  let timeout:ReturnType<typeof setTimeout>|undefined;
  try{return(await Promise.race([Notifications.getExpoPushTokenAsync({projectId}),new Promise<never>((_,reject)=>{
    timeout=setTimeout(()=>reject(new Error('Phone alert setup timed out. Try again when connected.')),15_000);
  })])).data;}finally{clearTimeout(timeout);}
}
// A tap opens an explicit review prompt. The payload cannot choose an account or authorize a journey.
export function listenForPush(onUpdate:(id:number)=>void,onReceive:()=>void=()=>{},onFamily:(eventId:string)=>void=()=>{}){
  if(!supported())return()=>{};
  const receive=(response:Notifications.NotificationResponse|null)=>{
    const target=pushTarget(response?.notification.request.content.data);
    if(target?.kind==='family')onFamily(target.eventId);
    else if(target?.kind==='journey')onUpdate(target.notificationId);
    Notifications.clearLastNotificationResponse();
  };
  receive(Notifications.getLastNotificationResponse());
  const listener=Notifications.addNotificationResponseReceivedListener(receive);
  const incoming=Notifications.addNotificationReceivedListener(onReceive);
  return()=>{listener.remove();incoming.remove();};
}
