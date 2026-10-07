import { check } from '../../shared/errors.mjs';
import { fields, label } from '../../shared/validation.mjs';

const VERSION=/^\d{1,3}\.\d{1,3}\.\d{1,3}(?:[-+][A-Za-z0-9.-]{1,32})?$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const permission=value=>['granted','denied','unknown'].includes(value)?value:'unknown';
export function heartbeatInput(data){
  fields(data,['platform','appVersion','nativeBuild','easBuildId','buildProfile','gitCommit','osVersion','locationPermission','backgroundLocationPermission','notificationPermission']);
  check(['ios','android'].includes(data.platform),'INVALID_INPUT','Choose a valid mobile platform.');
  check(typeof data.appVersion==='string'&&VERSION.test(data.appVersion),'INVALID_INPUT','Use a valid application version.');
  check(Number.isSafeInteger(data.nativeBuild)&&data.nativeBuild>=1&&data.nativeBuild<=2_147_483_647,'INVALID_INPUT','Use a valid native build number.');
  check(data.easBuildId===null||typeof data.easBuildId==='string'&&UUID.test(data.easBuildId),'INVALID_INPUT','Use a valid EAS build ID.');
  check(data.buildProfile===null||typeof data.buildProfile==='string'&&/^[A-Za-z0-9_-]{1,40}$/.test(data.buildProfile),'INVALID_INPUT','Use a valid build profile.');
  check(data.gitCommit===null||typeof data.gitCommit==='string'&&/^[a-f0-9]{40}$/i.test(data.gitCommit),'INVALID_INPUT','Use a valid build commit.');
  return {platform:data.platform,appVersion:data.appVersion,nativeBuild:data.nativeBuild,easBuildId:data.easBuildId,buildProfile:data.buildProfile,
    gitCommit:data.gitCommit,osVersion:label(data.osVersion,'OS version',1,40),locationPermission:permission(data.locationPermission),
    backgroundLocationPermission:permission(data.backgroundLocationPermission),notificationPermission:permission(data.notificationPermission)};
}
export function routeClass(path=''){
  const value=String(path).split('?')[0];
  for(const [prefix,name] of [['/auth/','auth'],['/session','session'],['/account/','account'],['/booking','booking'],['/work','work'],['/journeys/','journey'],['/tracking/','tracking'],['/notifications','notifications'],['/delivery-updates','notifications'],['/eats/','eats'],['/checkout-payments/','payments'],['/payments/','payments'],['/safety/','safety'],['/safety-monitoring/','safety'],['/family','family'],['/parcels/','parcel'],['/devices','devices'],['/driver/','driver']]) if(value.startsWith(prefix))return name;
  return 'other';
}
export function readMobileReleasePolicy(env={}){
  const integer=(name)=>{const value=env[name];if(value===undefined||value==='')return null;const n=Number(value);check(Number.isSafeInteger(n)&&n>=1&&n<=2_147_483_647,'INVALID_MOBILE_RELEASE_POLICY',`${name} must be a positive integer.`);return n;};
  const version=(name)=>{const value=env[name];if(value===undefined||value==='')return null;check(VERSION.test(value),'INVALID_MOBILE_RELEASE_POLICY',`${name} must be a semantic version.`);return value;};
  return Object.freeze({ios:{minimumBuild:integer('TAXI_AI_MOBILE_MIN_IOS_BUILD'),minimumVersion:version('TAXI_AI_MOBILE_MIN_IOS_VERSION')},
    android:{minimumBuild:integer('TAXI_AI_MOBILE_MIN_ANDROID_BUILD'),minimumVersion:version('TAXI_AI_MOBILE_MIN_ANDROID_VERSION')}});
}
export const validSessionId=value=>typeof value==='string'&&UUID.test(value);
