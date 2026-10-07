import Constants from 'expo-constants';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { MobileClient, MobileHeartbeat } from '../api/client';

const permission=(value:string|undefined):MobileHeartbeat['locationPermission']=>value==='granted'?'granted':value==='denied'?'denied':'unknown';
export async function mobileHeartbeat(client:MobileClient):Promise<void>{
  if(!['ios','android'].includes(Platform.OS)||!client.account())return;
  const nativeBuild=Number(Constants.nativeBuildVersion);
  if(!Number.isSafeInteger(nativeBuild)||nativeBuild<1)return;
  const release=(Constants.expoConfig?.extra?.release??{}) as Record<string,unknown>;
  const [foreground,background,notifications]=await Promise.all([
    Location.getForegroundPermissionsAsync(),Location.getBackgroundPermissionsAsync(),Notifications.getPermissionsAsync(),
  ]);
  const easBuildId=typeof release.buildId==='string'&&/^[a-f0-9-]{36}$/i.test(release.buildId)?release.buildId:null;
  const gitCommit=typeof release.gitCommit==='string'&&/^[a-f0-9]{40}$/i.test(release.gitCommit)?release.gitCommit:null;
  const buildProfile=typeof release.profile==='string'&&/^[A-Za-z0-9_-]{1,40}$/.test(release.profile)?release.profile:null;
  await client.deviceHealth({platform:Platform.OS as 'ios'|'android',appVersion:Constants.nativeApplicationVersion??Constants.expoConfig?.version??'0.0.0',nativeBuild,
    easBuildId,buildProfile,gitCommit,osVersion:String(Platform.Version).slice(0,40),locationPermission:permission(foreground.status),
    backgroundLocationPermission:permission(background.status),notificationPermission:permission(notifications.status)});
}
