import { el, panel, cards, table, detailsList, filterForm, count, percent, date } from './ui.mjs';
const seconds=value=>value==null?'—':`${Number(value).toFixed(value>=10?1:2)} s`;
const millis=value=>value==null?'—':`${Number(value).toFixed(value>=100?0:1)} ms`;
const score=value=>value==null?'—':Number(value).toFixed(3);
function completion(cohort){return cohort.requests?cohort.completed/cohort.requests:null;}
export function matching(data,route){
 const root=el('div');
 root.append(filterForm(route,[{name:'window',label:'Reporting window',options:[['24h','Last 24 hours'],['7d','Last 7 days'],['30d','Last 30 days']]}],{window:data.filters.window}));
 root.append(cards([
  ['Match p95',seconds(data.journeys.matchSeconds.p95),'Request created → driver matched',true],
  ['Offer acceptance',percent(data.offers.acceptanceRate),`${count(data.offers.accepted)} accepted of ${count(data.offers.resolved)} resolved offers`],
  ['Journey completion',percent(data.journeys.completionRate),`${count(data.journeys.completed)} completed of ${count(data.journeys.requests)} requests`],
  ['ML disagreement',percent(data.ml.disagreementRate),`${count(data.ml.disagreements)} of ${count(data.ml.comparisonCount)} recent shadow comparisons`],
 ]));
 const rollout=panel('Production rollout','Current matching and ML authority. Shadow ranking never chooses the live driver.');
 rollout.append(detailsList([
  ['Fast path',data.rollout.fastEnabled?'Enabled':'Disabled'],['Fast regions',data.rollout.fastRegions.length?data.rollout.fastRegions.join(', '):'All configured regions'],
  ['Dispatch mode',data.rollout.dispatchMode],['ML mode',data.rollout.mlMode],['ML model',data.rollout.mlModel||'None'],
  ['ML regions',data.rollout.mlRegions.length?data.rollout.mlRegions.join(', '):'All configured regions'],['ML live authority',data.rollout.mlLive?'Enabled':'Disabled'],
 ]));root.append(rollout);
 const performance=panel('Dispatch runtime samples','Persisted aggregate profiler samples. No SQL text, account IDs, ride IDs or coordinates are stored here.');
 performance.append(detailsList([
  ['Samples',count(data.performance.samples)],['Failed sampled cycles',count(data.performance.failed)],['Query-count p50 / p95',`${count(data.performance.queryCounts.p50??0)} / ${count(data.performance.queryCounts.p95??0)}`],
  ['DB query-time p95',millis(data.performance.queryMs.p95)],['Worker-cycle p95',millis(data.performance.cycleMs.p95)],['Transaction retries',count(data.performance.retries)],['Query errors',count(data.performance.queryErrors)],
 ]));
 if(data.performance.samples===0)performance.append(el('p','No persisted runtime samples are available in this window yet. Samples begin after this release is deployed and dispatch activity occurs.','definition-note'));
 root.append(performance);
 const readiness=data.ml.readiness,gate=panel('ML promotion gate',readiness.next);
 gate.append(detailsList([
  ['Closed real outcomes',`${count(readiness.observedOutcomes)} / ${count(readiness.minimumOutcomes)}`],['Minimum data reached',readiness.dataReady?'Yes':'No'],
  ['Trained on real outcomes',readiness.trainedOnRealOutcomes?'Yes':'No'],['Artifact training rows',count(readiness.artifactTrainingRows)],['Artifact approved for live',readiness.approvedForLive?'Yes':'No'],['Eligible for controlled live cohort',readiness.readyForControlledLive?'Yes':'No'],
 ]));root.append(gate);
 const wait=panel('Rider wait fairness','Observed matched-request cohorts. The ≥2 minute cohort is protected by the deterministic waiting-priority rule even when ML scores candidates.');
 wait.append(table(['Observed match wait','Requests','Completed','Completion rate'],[
  ['Under 60 seconds',count(data.waitCohorts.under60.requests),count(data.waitCohorts.under60.completed),percent(completion(data.waitCohorts.under60))],
  ['60–119 seconds',count(data.waitCohorts.from60To119.requests),count(data.waitCohorts.from60To119.completed),percent(completion(data.waitCohorts.from60To119))],
  ['120+ seconds',count(data.waitCohorts.atLeast120.requests),count(data.waitCohorts.atLeast120.completed),percent(completion(data.waitCohorts.atLeast120))],
 ],'Wait-time outcome cohorts'));root.append(wait);
 const offers=panel('Dispatch outcomes','Resolved offers and estimate source over the selected reporting window.');
 offers.append(table(['Status','Estimate source','Count'],data.offers.byStatusAndEstimate.map(row=>[row.status,row.etaSource,count(row.count)])));root.append(offers);
 const compare=panel('Recent deterministic vs ML shadow comparisons','No driver, rider, ride or exact-location identifiers are exposed.');
 compare.append(data.ml.recentComparisons.length?table(['Recorded','Region','Model','Disagreed','Control choice ML rank','ML choice control rank','Control score','ML score','Actual remained control'],data.ml.recentComparisons.map(row=>[
  date(row.createdAt),row.region,row.modelVersion,row.disagreed?'Yes':'No',row.controlModelRank??'—',row.modelDeterministicRank??'—',score(row.controlScore),score(row.modelScore),row.actualWasControl?'Yes':'No'
 ]),'Recent privacy-limited matching comparisons'):el('p','No ML shadow comparisons have been recorded in this window yet.','definition-note'));root.append(compare);
 root.append(el('p',`Window begins ${date(data.filters.since)}. Match-time percentiles use up to the latest ${count(data.journeys.timingRows)} timed matches${data.journeys.timingCapped?' (bounded at 5,000)':''}. Runtime samples are also bounded at 5,000 rows per view.`, 'definition-note'));
 return root;
}
