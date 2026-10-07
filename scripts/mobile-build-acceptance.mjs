import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url)),mobile=resolve(root,'apps/mobile');
const EAS='24.10.0';
function args(argv){
 let platform='all',run=false;
 for(let i=0;i<argv.length;i++){
  if(argv[i]==='--platform')platform=argv[++i]??'';else if(argv[i]==='--run')run=true;else throw new Error(`Unknown option: ${argv[i]}`);
 }
 if(!['ios','android','all'].includes(platform))throw new Error('Platform must be ios, android or all.');
 return{platform,run};
}
function execute(bin,values,{capture=false,check=true}={}){
 const result=spawnSync(bin,values,{cwd:mobile,encoding:'utf8',stdio:capture?'pipe':'inherit',env:process.env});
 if(result.error)throw result.error;
 if(check&&result.status!==0)throw new Error(`Command failed with exit ${result.status}.`);
 return result;
}
function eas(...values){return ['--yes',`eas-cli@${EAS}`,...values];}
function readinessCommand(platform){return `node --env-file-if-exists=.env ../../scripts/mobile-release-readiness.mjs --profile acceptance --platform ${platform}`;}

try{
 const option=args(process.argv.slice(2));
 console.log(`Taxi Ai signed-device acceptance · ${option.platform}`);
 console.log('1. Checking Expo/EAS authentication...');
 execute('npx',eas('whoami'));
 console.log('2. Checking the linked EAS project...');
 execute('npx',eas('project:info'));
 console.log('3. Validating the preview EAS environment without printing secret values...');
 execute('npx',eas('env:exec','preview',readinessCommand(option.platform),'--non-interactive'));
 if(!option.run){
  console.log('MOBILE_ACCEPTANCE_READY_TO_QUEUE');
  console.log(`Queue only after reviewing EAS build usage/charges: npm run acceptance:build -- --platform ${option.platform} --run`);
  console.log('For a physical iPhone, register the device first with: npx eas-cli@24.10.0 device:create');
  process.exit(0);
 }
 console.log('4. Queueing signed internal build(s). This can consume EAS build quota or incur provider charges.');
 const result=execute('npx',eas('build','--platform',option.platform,'--profile','acceptance','--json','--no-wait'),{capture:true});
 process.stdout.write(result.stderr??'');
 let builds;
 try{builds=JSON.parse(result.stdout);}catch{throw new Error('EAS queued the build but its JSON response could not be parsed. Use eas build:list to inspect it.');}
 const rows=Array.isArray(builds)?builds:[builds];
 for(const build of rows){
  const id=typeof build?.id==='string'?build.id:'unknown',platform=build?.platform??'unknown',status=build?.status??'queued';
  console.log(`QUEUED ${platform} · ${id} · ${status}`);
 }
 console.log('MOBILE_ACCEPTANCE_BUILD_QUEUED');
}catch(error){console.error(error instanceof Error?error.message:'Unable to prepare the mobile acceptance build.');process.exitCode=1;}
