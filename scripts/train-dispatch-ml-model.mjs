import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { DISPATCH_ML_FEATURE_NAMES, validateDispatchMlArtifact } from '../packages/shared/src/dispatch-ml.mjs';

const [inputArg,outputArg,version]=process.argv.slice(2);
if(!inputArg||!outputArg||!version||process.argv.length!==5||!/^[A-Za-z0-9_.-]{1,80}$/.test(version))
  throw new Error('Usage: node scripts/train-dispatch-ml-model.mjs INPUT.ndjson NEW_MODEL.json MODEL_VERSION');
const input=resolve(inputArg),output=resolve(outputArg);
if(!input.endsWith('.ndjson')||!output.endsWith('.json'))throw new Error('Use .ndjson input and a new .json output path.');
const lines=(await readFile(input,'utf8')).split('\n').filter(Boolean);
if(lines.length<1500)throw new Error('At least 1,500 observed offer outcomes are required before training a dispatch model.');

const rows=lines.map((line,index)=>{
  const value=JSON.parse(line),features=value.features,observed=value.observed;
  if(!features||!observed||!DISPATCH_ML_FEATURE_NAMES.every(name=>Number.isFinite(features[name]))
    || ![0,1].includes(observed.accepted)||![0,1].includes(observed.completed))throw new Error(`Invalid training row ${index+1}.`);
  // Completion is the primary target; a completed trip necessarily passed acceptance.
  return {features,label:observed.completed===1?1:0,key:createHash('sha256').update(line).digest()[0]};
});
const train=rows.filter(row=>row.key>=51),test=rows.filter(row=>row.key<51);
if(train.length<800||test.length<100)throw new Error('Deterministic holdout split is too small; collect more outcomes.');
const specs={};
for(const name of DISPATCH_ML_FEATURE_NAMES){
  const values=train.map(row=>row.features[name]),mean=values.reduce((a,b)=>a+b,0)/values.length;
  const variance=values.reduce((sum,value)=>sum+(value-mean)**2,0)/values.length;
  specs[name]={mean,scale:Math.max(Math.sqrt(variance),1e-6)};
}
const vector=row=>DISPATCH_ML_FEATURE_NAMES.map(name=>(row.features[name]-specs[name].mean)/specs[name].scale);
const sigmoid=x=>1/(1+Math.exp(-Math.max(-30,Math.min(30,x))));
let weights=Array(DISPATCH_ML_FEATURE_NAMES.length).fill(0),intercept=0;
const rate=0.08,l2=0.002,epochs=350;
for(let epoch=0;epoch<epochs;epoch++){
  const gw=Array(weights.length).fill(0);let gb=0;
  for(const row of train){
    const x=vector(row),p=sigmoid(intercept+x.reduce((sum,value,i)=>sum+value*weights[i],0)),error=p-row.label;
    gb+=error;for(let i=0;i<gw.length;i++)gw[i]+=error*x[i];
  }
  intercept-=rate*gb/train.length;
  for(let i=0;i<weights.length;i++)weights[i]-=rate*(gw[i]/train.length+l2*weights[i]);
}
const predict=row=>sigmoid(intercept+vector(row).reduce((sum,value,i)=>sum+value*weights[i],0));
function auc(data){
  const ranked=data.map(row=>({p:predict(row),y:row.label})).sort((a,b)=>a.p-b.p);let rankSum=0,pos=0,neg=0;
  for(let i=0;i<ranked.length;){let j=i+1;while(j<ranked.length&&Math.abs(ranked[j].p-ranked[i].p)<1e-12)j++;
    const averageRank=(i+1+j)/2;for(let k=i;k<j;k++){if(ranked[k].y){rankSum+=averageRank;pos++;}else neg++;}i=j;}
  return pos&&neg?(rankSum-pos*(pos+1)/2)/(pos*neg):null;
}
const brier=data=>data.reduce((sum,row)=>sum+(predict(row)-row.label)**2,0)/data.length;
const positiveRate=train.reduce((n,row)=>n+row.label,0)/train.length;
const metrics={trainRows:train.length,holdoutRows:test.length,positiveRate,holdoutAuc:auc(test),holdoutBrier:brier(test),
  baselineBrier:test.reduce((sum,row)=>sum+(positiveRate-row.label)**2,0)/test.length};
const artifact={schemaVersion:1,type:'linear_logit',version,purpose:'dispatch_completion_probability',features:specs,intercept,
  weights:Object.fromEntries(DISPATCH_ML_FEATURE_NAMES.map((name,i)=>[name,weights[i]])),approval:{trainedOnRealOutcomes:true,approvedForLive:false,
    trainingRows:train.length,holdoutRows:test.length,offlineMetrics:metrics,note:'Trained from observed Taxi AI offers. Live approval requires review, fairness analysis and staged rollout.'}};
validateDispatchMlArtifact(artifact);
await writeFile(output,JSON.stringify(artifact,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({event:'dispatch_ml_model_trained',version,output,metrics},null,2));
