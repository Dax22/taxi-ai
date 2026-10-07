const marks = ids => ids.map(() => '?').join(',');
export function createDispatchMlRepository(db) {
  return Object.freeze({
    async driverStats(driverIds, since) {
      if (!driverIds.length) return [];
      return db.prepare(`SELECT o.driver_id AS driverId,COUNT(*) AS offers,
        SUM(CASE WHEN o.status='accepted' THEN 1 ELSE 0 END) AS accepted,
        SUM(CASE WHEN o.status='declined' THEN 1 ELSE 0 END) AS declined,
        SUM(CASE WHEN o.status='expired' THEN 1 ELSE 0 END) AS expired,
        SUM(CASE WHEN o.status='accepted' AND j.completed_at IS NOT NULL THEN 1 ELSE 0 END) AS completed
        FROM dispatch_offers o LEFT JOIN dispatch_journeys j ON j.ride_id=o.ride_id
        WHERE o.driver_id IN (${marks(driverIds)}) AND o.created_at>=? GROUP BY o.driver_id`).all(...driverIds,since);
    },
    async record(rows) {
      const statement = db.prepare(`INSERT INTO dispatch_ml_decisions
        (id,cycle_id,ride_id,driver_id,region,model_version,rollout_mode,score,deterministic_rank,model_rank,
         selected_control,selected_model,selected_actual,features_json,created_at,offer_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(cycle_id,ride_id,driver_id) DO NOTHING`);
      for (const row of rows) await statement.run(row.id,row.cycleId,row.rideId,row.driverId,row.region,row.modelVersion,row.rolloutMode,
        row.score,row.deterministicRank,row.modelRank,row.selectedControl,row.selectedModel,row.selectedActual,row.featuresJson,row.createdAt,row.offerId);
    },
    async metrics(since) {
      return db.prepare(`SELECT model_version AS modelVersion,rollout_mode AS rolloutMode,COUNT(*) AS candidates,
        SUM(selected_actual) AS actualOffers,SUM(CASE WHEN selected_control<>selected_model THEN 1 ELSE 0 END) AS disagreements,
        AVG(score) AS meanScore FROM dispatch_ml_decisions WHERE created_at>=?
        GROUP BY model_version,rollout_mode ORDER BY model_version,rollout_mode`).all(since);
    },
    async sweep(before, limit = 1000) {
      const bounded = Math.max(1,Math.min(5000,Number.isSafeInteger(limit)?limit:1000));
      return (await db.prepare(`DELETE FROM dispatch_ml_decisions WHERE id IN
        (SELECT id FROM dispatch_ml_decisions WHERE created_at<? ORDER BY created_at,id LIMIT ?)`).run(before,bounded)).changes;
    },
  });
}
