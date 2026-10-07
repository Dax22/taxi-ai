import {matchingFilters,distribution,ratio} from './domain.mjs';
import {dispatchMlReadiness} from '../../../../../packages/shared/src/dispatch-ml-readiness.mjs';
const n=value=>Number(value??0);
export function createAdminMatchingService({repository,requirePermission,clock,unitOfWork,configuration}){return Object.freeze({
 async get(user,query={}){return unitOfWork(async()=>{
  await requirePermission(user.id,'operations.read');const now=clock(),filter=matchingFilters(query,now),summary=await repository.journeySummary(filter.since);
  const timings=await repository.journeyTimings(filter.since),offers=await repository.offers(filter.since),profiles=await repository.profiles(filter.since),cohorts=await repository.mlCohorts(filter.since);
  const comparisonSummary=await repository.mlComparisonSummary(filter.since),comparisons=await repository.comparisons(filter.since),outcomes=await repository.mlOutcomes(filter.since),training=n((await repository.trainingRows()).count),config=configuration();
  const {modelArtifact,...rollout}=config;
  const matchSeconds=timings.map(row=>(n(row.matchedAt)-n(row.createdAt))/1000).filter(v=>v>=0),match=distribution(matchSeconds);
  const accepted=offers.filter(row=>row.status==='accepted').reduce((s,row)=>s+n(row.count),0),declined=offers.filter(row=>row.status==='declined').reduce((s,row)=>s+n(row.count),0),expired=offers.filter(row=>row.status==='expired').reduce((s,row)=>s+n(row.count),0);
  const resolved=accepted+declined+expired,requests=n(summary.requests),completed=n(summary.completed),cancelled=n(summary.cancelled),matched=n(summary.matched);
  const queryCounts=distribution(profiles.map(row=>n(row.queryCount))),queryMs=distribution(profiles.map(row=>n(row.queryMs))),cycles=distribution(profiles.map(row=>n(row.durationMs)));
  const totalCandidates=cohorts.reduce((s,row)=>s+n(row.candidates),0),actualOffers=cohorts.reduce((s,row)=>s+n(row.actualOffers),0);
  const comparisonCount=n(comparisonSummary.comparisons),disagreements=n(comparisonSummary.disagreements);
  const wait={under60:{requests:0,completed:0},from60To119:{requests:0,completed:0},atLeast120:{requests:0,completed:0}};
  for(const row of timings){const seconds=(n(row.matchedAt)-n(row.createdAt))/1000,bucket=seconds>=120?wait.atLeast120:seconds>=60?wait.from60To119:wait.under60;bucket.requests++;bucket.completed+=row.completedAt?1:0;}
  return {viewerId:user.id,asOf:now,timezone:'Africa/Lagos',filters:{window:filter.window,since:filter.since},rollout,
   journeys:{requests,matched,completed,cancelled,expired:n(summary.expired),matchRate:ratio(matched,requests),completionRate:ratio(completed,requests),cancellationRate:ratio(cancelled,requests),matchSeconds:match,timingRows:timings.length,timingCapped:timings.length===5000},
   offers:{accepted,declined,expired,resolved,acceptanceRate:ratio(accepted,resolved),byStatusAndEstimate:offers},
   performance:{samples:profiles.length,failed:profiles.filter(row=>n(row.failed)===1).length,queryCounts,queryMs,cycleMs:cycles,retries:profiles.reduce((s,row)=>s+n(row.retries),0),queryErrors:profiles.reduce((s,row)=>s+n(row.queryErrors),0),capped:profiles.length===5000},
   ml:{cohorts,candidates:totalCandidates,actualOffers,comparisonCount,disagreements,disagreementRate:ratio(disagreements,comparisonCount),outcomes,recentComparisons:comparisons,readiness:dispatchMlReadiness({observedOutcomes:training,model:modelArtifact,mode:config.mlMode})},
   waitCohorts:wait,
  };
 });}
});}
