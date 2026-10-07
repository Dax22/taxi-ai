import { readFileSync, existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url)),mobile=resolve(root,'apps/mobile');
const uuid=/^[a-f0-9-]{36}$/i,clientId=/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/;
const mapsKey=/^[A-Za-z0-9_-]{20,200}$/;
const packageId=/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/i;

function parseArgs(argv){
 let platform='all',profile='acceptance',json=false;
 for(let i=0;i<argv.length;i++){
  const arg=argv[i];
  if(arg==='--platform')platform=argv[++i]??'';else if(arg==='--profile')profile=argv[++i]??'';else if(arg==='--json')json=true;else throw new Error(`Unknown option: ${arg}`);
 }
 if(!['ios','android','all'].includes(platform))throw new Error('Platform must be ios, android or all.');
 if(!['acceptance','preview','production'].includes(profile))throw new Error('Profile must be acceptance, preview or production.');
 return{platform,profile,json};
}
function httpsOrigin(value){
 try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&u.pathname==='/'&&!u.search&&!u.hash?u.origin:null;}catch{return null;}
}
function firebasePackage(path){
 try{
  const doc=JSON.parse(readFileSync(path,'utf8'));
  const packages=(doc.client??[]).map(c=>c?.client_info?.android_client_info?.package_name).filter(v=>typeof v==='string');
  return packages;
 }catch{return null;}
}
function buildProfile(build,name,seen=new Set()){
 const current=build?.[name];if(!current||typeof current!=='object'||Array.isArray(current))return null;
 if(seen.has(name))return null;const next=new Set(seen).add(name);
 const parent=typeof current.extends==='string'?buildProfile(build,current.extends,next):{};
 if(current.extends&&parent===null)return null;
 return {...(parent??{}),...current,
  env:{...(parent?.env??{}),...(current.env??{})},android:{...(parent?.android??{}),...(current.android??{})},ios:{...(parent?.ios??{}),...(current.ios??{})}};
}
export function releaseReadiness({env=process.env,platform='all',profile='acceptance',appJson,easJson,mobilePackage,fileExists=existsSync}={}){
 const app=appJson??JSON.parse(readFileSync(resolve(mobile,'app.json'),'utf8'));
 const eas=easJson??JSON.parse(readFileSync(resolve(mobile,'eas.json'),'utf8'));
 const pkg=mobilePackage??JSON.parse(readFileSync(resolve(mobile,'package.json'),'utf8'));
 const checks=[];const add=(id,ok,detail)=>checks.push({id,ok:Boolean(ok),detail});
 const expo=app.expo??{},ios=expo.ios??{},android=expo.android??{},build=eas.build??{},rawProfile=build[profile],selected=buildProfile(build,profile);
 add('profile.exists',rawProfile&&selected,`EAS profile ${profile}`);
 if(profile==='acceptance'){add('profile.internal',selected?.distribution==='internal','Acceptance builds use internal distribution');add('profile.environment',selected?.environment==='preview','Acceptance builds use the preview EAS environment');add('profile.auto_increment',selected?.autoIncrement===true,'Acceptance builds auto-increment native build numbers');}
 if(profile==='production'){add('profile.store',selected?.distribution==='store','Production builds use store distribution');add('profile.environment',selected?.environment==='production','Production builds use the production EAS environment');}
 add('package.ids',packageId.test(ios.bundleIdentifier??'')&&ios.bundleIdentifier===android.package,`iOS/Android app ID ${ios.bundleIdentifier??'missing'}`);
 add('version.aligned',expo.version===pkg.version,`App ${expo.version??'missing'} · package ${pkg.version??'missing'}`);
 add('expo.project',uuid.test(env.EXPO_PUBLIC_EXPO_PROJECT_ID??''),'Expo project UUID configured');
 const origin=httpsOrigin(env.EXPO_PUBLIC_API_ORIGIN??'');
 add('api.https',Boolean(origin),'HTTPS API origin configured');
 if(profile==='acceptance'||profile==='production')add('api.production',origin==='https://taxiai.app','Acceptance/production builds target https://taxiai.app');
 add('google.web',clientId.test(env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID??''),'Google web OAuth client ID configured');
 const platforms=platform==='all'?['ios','android']:[platform];
 if(platforms.includes('ios'))add('google.ios',clientId.test(env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID??''),'Google iOS OAuth client ID configured');
 if(platforms.includes('android')){
  add('maps.android',mapsKey.test(env.GOOGLE_MAPS_ANDROID_API_KEY??''),'Restricted Android Maps SDK key configured');
  const file=env.GOOGLE_SERVICES_JSON??'',present=Boolean(file)&&fileExists(file),packages=present?firebasePackage(file):null;
  add('firebase.android_file',present,`Firebase Android client file ${present?basename(file):'missing'}`);
  add('firebase.android_package',Array.isArray(packages)&&packages.includes(android.package),`Firebase Android package matches ${android.package??'missing'}`);
 }
 return{platform,profile,ready:checks.every(c=>c.ok),checks,summary:{version:expo.version??null,iosBundleId:ios.bundleIdentifier??null,androidPackage:android.package??null,apiOrigin:origin}};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{
  const args=parseArgs(process.argv.slice(2)),result=releaseReadiness(args);
  if(args.json)console.log(JSON.stringify(result,null,2));else{
   console.log(`Taxi Ai mobile ${args.profile} readiness · ${args.platform}`);
   for(const check of result.checks)console.log(`${check.ok?'PASS':'FAIL'} ${check.id} · ${check.detail}`);
   console.log(result.ready?'MOBILE_RELEASE_READY':'MOBILE_RELEASE_NOT_READY');
  }
  if(!result.ready)process.exitCode=1;
 }catch(error){console.error(error instanceof Error?error.message:'Mobile release readiness failed.');process.exitCode=1;}
}
