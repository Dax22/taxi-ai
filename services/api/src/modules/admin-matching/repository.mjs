export function createAdminMatchingRepository(db){return Object.freeze({
 journeySummary:since=>db.prepare(`SELECT count(*) AS requests,COALESCE(sum(CASE WHEN matched_at IS NOT NULL THEN 1 ELSE 0 END),0) AS matched,
  COALESCE(sum(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END),0) AS completed,COALESCE(sum(CASE WHEN outcome='cancelled' THEN 1 ELSE 0 END),0) AS cancelled,
  COALESCE(sum(CASE WHEN outcome='expired' THEN 1 ELSE 0 END),0) AS expired FROM dispatch_journeys WHERE created_at>=?`).get(since),
 journeyTimings:(since,limit=5000)=>db.prepare(`SELECT created_at AS createdAt,matched_at AS matchedAt,completed_at AS completedAt
  FROM dispatch_journeys WHERE created_at>=? AND matched_at IS NOT NULL ORDER BY created_at DESC LIMIT ?`).all(since,limit),
 offers:since=>db.prepare(`SELECT status,eta_source AS etaSource,count(*) AS count FROM dispatch_offers WHERE created_at>=? GROUP BY status,eta_source ORDER BY status,eta_source`).all(since),
 profiles:(since,limit=5000)=>db.prepare(`SELECT region,sample_every AS sampleEvery,duration_ms AS durationMs,query_count AS queryCount,
  query_ms AS queryMs,query_errors AS queryErrors,transactions,retries,failed,discovery_ms AS discoveryMs,routing_ms AS routingMs,commit_ms AS commitMs,created_at AS createdAt
  FROM dispatch_profile_samples WHERE created_at>=? ORDER BY created_at DESC LIMIT ?`).all(since,limit),
 mlCohorts:since=>db.prepare(`SELECT model_version AS modelVersion,rollout_mode AS rolloutMode,count(*) AS candidates,
  COALESCE(sum(selected_actual),0) AS actualOffers,COALESCE(sum(CASE WHEN selected_control<>selected_model THEN 1 ELSE 0 END),0) AS differingCandidateSelections,
  AVG(score) AS meanScore FROM dispatch_ml_decisions WHERE created_at>=? GROUP BY model_version,rollout_mode ORDER BY model_version,rollout_mode`).all(since),
 mlComparisonSummary:since=>db.prepare(`SELECT count(*) AS comparisons,COALESCE(sum(disagreed),0) AS disagreements FROM (
  SELECT MAX(CASE WHEN selected_control<>selected_model THEN 1 ELSE 0 END) AS disagreed
  FROM dispatch_ml_decisions WHERE created_at>=? GROUP BY cycle_id,ride_id) decisions`).get(since),
 trainingRows:()=>db.prepare(`SELECT count(*) AS count FROM dispatch_ml_decisions d JOIN dispatch_offers o ON o.id=d.offer_id
  WHERE d.selected_actual=1 AND o.status<>'pending'`).get(),
 comparisons:(since,limit=20)=>db.prepare(`SELECT region,model_version AS modelVersion,rollout_mode AS rolloutMode,MAX(created_at) AS createdAt,
  MAX(CASE WHEN selected_control=1 THEN score END) AS controlScore,MAX(CASE WHEN selected_model=1 THEN score END) AS modelScore,
  MAX(CASE WHEN selected_control=1 THEN model_rank END) AS controlModelRank,
  MAX(CASE WHEN selected_model=1 THEN deterministic_rank END) AS modelDeterministicRank,
  MAX(CASE WHEN selected_control<>selected_model THEN 1 ELSE 0 END) AS disagreed,
  MAX(CASE WHEN selected_actual=1 AND selected_control=1 THEN 1 ELSE 0 END) AS actualWasControl
  FROM dispatch_ml_decisions WHERE created_at>=? GROUP BY cycle_id,ride_id,region,model_version,rollout_mode ORDER BY createdAt DESC LIMIT ?`).all(since,limit),
 mlOutcomes:since=>db.prepare(`SELECT o.status,COUNT(*) AS count,COALESCE(sum(CASE WHEN j.completed_at IS NOT NULL THEN 1 ELSE 0 END),0) AS completed
  FROM dispatch_ml_decisions d JOIN dispatch_offers o ON o.id=d.offer_id LEFT JOIN dispatch_journeys j ON j.ride_id=d.ride_id
  WHERE d.selected_actual=1 AND d.created_at>=? GROUP BY o.status ORDER BY o.status`).all(since),
});}
