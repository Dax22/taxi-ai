const regionPattern=/^(?:ng:\d{1,3}:\d{1,3}|sample:[a-z0-9-]{1,80})$/;
const number=(value)=>Number.isFinite(value)&&value>=0?value:0;
export function createDispatchPerformanceService({repository,tokens,clock,retentionDays=30}){
 let nextSweepAt=0;
 return Object.freeze({
  async record(value){
   if(!value||!Number.isInteger(value.sampleEvery)||value.sampleEvery<1)return;
   const region=typeof value.region==='string'&&regionPattern.test(value.region)?value.region:null;
   await repository.insert({id:tokens.id(),region,sampleEvery:value.sampleEvery,durationMs:number(value.durationMs),
    queryCount:Math.floor(number(value.queryCount)),queryMs:number(value.queryMs),queryErrors:Math.floor(number(value.queryErrors)),
    transactions:Math.floor(number(value.transactions)),retries:Math.floor(number(value.retries)),failed:value.failed?1:0,
    discoveryMs:value.phases?.discovery===undefined?null:number(value.phases.discovery),routingMs:value.phases?.routing===undefined?null:number(value.phases.routing),
    commitMs:value.phases?.commit===undefined?null:number(value.phases.commit),createdAt:clock()});
  },
  async sweep(){const now=clock();if(now<nextSweepAt)return 0;nextSweepAt=now+60*60_000;return repository.sweep(Math.max(0,now-retentionDays*24*60*60_000),1000);}
 });
}
