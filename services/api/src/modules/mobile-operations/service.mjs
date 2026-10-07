import { heartbeatInput, routeClass } from './domain.mjs';
export function createMobileOperationsService({repository,clock=Date.now,sampleEvery=20}){
  if(!Number.isSafeInteger(sampleEvery)||sampleEvery<1||sampleEvery>1000) throw new Error('TAXI_AI_MOBILE_API_SAMPLE_EVERY must be an integer from 1 to 1000.');
  let successCounter=0;
  async function heartbeat(context,data){const input=heartbeatInput(data);await repository.heartbeat({...context,...input,now:clock()});return {recorded:true};}
  async function recordApi({path,method,statusCode,durationMs}){
    const success=statusCode<400;if(success&&++successCounter%sampleEvery!==0)return;
    const ms=Math.max(0,Math.min(120000,Math.round(Number(durationMs)||0)));
    await repository.apiSample({routeClass:routeClass(path),method:method==='POST'?'POST':'GET',statusCode:Number(statusCode)||500,durationMs:ms,sampleWeight:success?sampleEvery:1,now:clock()});
  }
  return Object.freeze({heartbeat,recordApi,sweep:()=>repository.purge(clock()),sampleEvery});
}
