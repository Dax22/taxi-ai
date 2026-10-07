import { dispatchMlFeatures, scoreDispatchMl, validateDispatchMlArtifact } from '../../../../../packages/shared/src/dispatch-ml.mjs';
import { DISPATCH_POLICY } from '../../../../../packages/shared/src/dispatch.mjs';
import { matchingPairKey } from '../../shared/matching-pair-key.mjs';

const MAX_LOGGED_PER_RIDE = 8;
const selected = offers => new Set(offers.map(offer => matchingPairKey(offer.rideId,offer.driverId)));
const deterministicCost = (candidate, now) => {
  const road = Number.isFinite(candidate.pickupEtaSeconds);
  const pickup = road ? candidate.pickupEtaSeconds : candidate.distanceMeters === null
    ? DISPATCH_POLICY.samplePickupCostSeconds + DISPATCH_POLICY.fallbackPenaltySeconds
    : candidate.distanceMeters / DISPATCH_POLICY.fallbackSpeedMetersPerSecond + DISPATCH_POLICY.fallbackPenaltySeconds;
  const age = now-candidate.createdAt, priority = age>=DISPATCH_POLICY.waitingPriorityMs;
  const credit = Math.min(age,DISPATCH_POLICY.waitingCreditLimitMs)/1000 + (priority?DISPATCH_POLICY.maxPickupEtaSeconds:0);
  return pickup-credit;
};

export function createDispatchMlRanker({ config, model, repository, tokens, clock }) {
  const artifact = model ? Object.freeze(validateDispatchMlArtifact(model,{live:config.mode==='live'})) : null;
  const enabled = config.mode !== 'off' && artifact;
  let nextSweepAt = 0;
  async function prefetch(candidates, now, region) {
    if (!enabled || !config.includesRegion(region) || !candidates.length) return null;
    const driverIds=[...new Set(candidates.map(c=>c.driverId))];
    const rows=await repository.driverStats(driverIds,Math.max(0,now-30*24*60*60_000));
    return new Map(rows.map(row=>[row.driverId,{offers:Number(row.offers),accepted:Number(row.accepted),declined:Number(row.declined),
      expired:Number(row.expired),completed:Number(row.completed)}]));
  }
  function plan(candidates, now, region, history) {
    if (!enabled || !history || !config.includesRegion(region) || !candidates.length) return null;
    const cycleId=tokens.id(), scores=new Map();
    for (const candidate of candidates) {
      const features=dispatchMlFeatures(candidate,history.get(candidate.driverId),now);
      const score=scoreDispatchMl(artifact,features);
      scores.set(matchingPairKey(candidate.rideId,candidate.driverId),{score,features,cost:Math.round((1-score)*1_000_000)});
    }
    return Object.freeze({cycleId,region,mode:config.mode,modelVersion:artifact.version,scores,
      costFor:candidate=>scores.get(matchingPairKey(candidate.rideId,candidate.driverId))?.cost});
  }
  async function record(planValue, candidates, controlOffers, modelOffers, actualOffers, now) {
    if (!planValue) return;
    const control=selected(controlOffers), modelSelected=selected(modelOffers), actual=new Map(actualOffers.map(offer=>[matchingPairKey(offer.rideId,offer.driverId),offer.id]));
    const byRide=new Map();
    for (const candidate of candidates) {
      if (!byRide.has(candidate.rideId)) byRide.set(candidate.rideId,[]);
      byRide.get(candidate.rideId).push(candidate);
    }
    const rows=[];
    for (const [rideId,items] of byRide) {
      const deterministic=[...items].sort((a,b)=>deterministicCost(a,now)-deterministicCost(b,now)||a.driverId.localeCompare(b.driverId));
      const learned=[...items].sort((a,b)=>(planValue.scores.get(matchingPairKey(b.rideId,b.driverId))?.score??-1)
        -(planValue.scores.get(matchingPairKey(a.rideId,a.driverId))?.score??-1)||a.driverId.localeCompare(b.driverId));
      const dRank=new Map(deterministic.map((c,i)=>[c.driverId,i+1])), mRank=new Map(learned.map((c,i)=>[c.driverId,i+1]));
      const keep=new Set([...deterministic.slice(0,MAX_LOGGED_PER_RIDE),...learned.slice(0,MAX_LOGGED_PER_RIDE)]
        .map(c=>matchingPairKey(c.rideId,c.driverId)));
      for (const candidate of items) {
        const key=matchingPairKey(rideId,candidate.driverId), scored=planValue.scores.get(key);
        if (!scored || (!keep.has(key) && !actual.has(key))) continue;
        rows.push({id:tokens.id(),cycleId:planValue.cycleId,rideId,driverId:candidate.driverId,region:planValue.region,
          modelVersion:planValue.modelVersion,rolloutMode:planValue.mode,score:scored.score,deterministicRank:dRank.get(candidate.driverId),
          modelRank:mRank.get(candidate.driverId),selectedControl:control.has(key)?1:0,selectedModel:modelSelected.has(key)?1:0,
          selectedActual:actual.has(key)?1:0,featuresJson:JSON.stringify(scored.features),createdAt:now,offerId:actual.get(key)??null});
      }
    }
    await repository.record(rows);
  }
  return Object.freeze({enabled:Boolean(enabled),mode:config.mode,version:artifact?.version??null,prefetch,plan,record,
    liveFor:region=>Boolean(enabled&&config.mode==='live'&&config.includesRegion(region)),
    metrics:since=>enabled?repository.metrics(since):Promise.resolve([]),
    async sweep(){ const now=clock(); if(!enabled||now<nextSweepAt)return {deleted:0}; nextSweepAt=now+60*60_000;
      return {deleted:await repository.sweep(Math.max(0,now-config.retentionDays*24*60*60_000),1000)}; }});
}
