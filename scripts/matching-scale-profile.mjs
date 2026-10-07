import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { runMatchingBenchmark } from './matching-benchmark.mjs';

export const MATCHING_SCALE_PROFILES=Object.freeze({
 smoke:Object.freeze({rate:1,durationSeconds:30,warmupSeconds:5,actors:40,apiInstances:2,workers:2,poolSize:4,idleAccounts:0,maxMatchP95Ms:10000,fastPath:true}),
 city:Object.freeze({rate:5,durationSeconds:60,warmupSeconds:10,actors:120,apiInstances:2,workers:2,poolSize:8,idleAccounts:0,maxMatchP95Ms:10000,fastPath:true}),
 regional:Object.freeze({rate:10,durationSeconds:120,warmupSeconds:15,actors:200,apiInstances:4,workers:4,poolSize:8,idleAccounts:0,maxMatchP95Ms:10000,fastPath:true}),
 'million-cardinality':Object.freeze({rate:5,durationSeconds:60,warmupSeconds:10,actors:120,apiInstances:4,workers:4,poolSize:8,idleAccounts:1000000,maxMatchP95Ms:10000,fastPath:true}),
});
export function scaleProfile(name){const profile=MATCHING_SCALE_PROFILES[name];if(!profile)throw new Error('Profile must be smoke, city, regional or million-cardinality.');return {...profile};}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const [name,output]=process.argv.slice(2);if(!name||!output||process.argv.length!==4||!output.endsWith('.json'))throw new Error('Usage: npm run matching:scale -- PROFILE NEW_REPORT.json');
  const configuration=scaleProfile(name),report=await runMatchingBenchmark(configuration);
  const result={...report,scaleProfile:name,scaleStatement:name==='million-cardinality'
   ?'One million idle accounts test storage/index cardinality only. It is not one million concurrent or active users.'
   :'Synthetic staged load evidence on the selected host; not a production capacity guarantee.'};
  await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({profile:name,passed:result.passed,scheduled:result.measurement.arrivals.scheduled,completed:result.measurement.journeys.completed,
   p95Ms:result.measurement.journeys.timeToAcceptedOfferMs.p95,errorRate:result.measurement.errorRate,statement:result.scaleStatement},null,2));
  if(!result.passed)process.exitCode=1;
 }catch(error){console.error(error.message);process.exitCode=1;}
}
