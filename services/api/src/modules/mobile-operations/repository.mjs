export function createMobileOperationsRepository(db){
  return Object.freeze({
    async heartbeat(row){
      return db.prepare(`INSERT INTO mobile_device_health(session_id,user_id,platform,app_version,native_build,eas_build_id,build_profile,git_commit,os_version,location_permission,background_location_permission,notification_permission,first_seen_at,last_seen_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET user_id=excluded.user_id,platform=excluded.platform,app_version=excluded.app_version,native_build=excluded.native_build,
        eas_build_id=excluded.eas_build_id,build_profile=excluded.build_profile,git_commit=excluded.git_commit,os_version=excluded.os_version,location_permission=excluded.location_permission,
        background_location_permission=excluded.background_location_permission,notification_permission=excluded.notification_permission,last_seen_at=excluded.last_seen_at`)
        .run(row.sessionId,row.userId,row.platform,row.appVersion,row.nativeBuild,row.easBuildId,row.buildProfile,row.gitCommit,row.osVersion,row.locationPermission,row.backgroundLocationPermission,row.notificationPermission,row.now,row.now);
    },
    apiSample:row=>db.prepare(`INSERT INTO mobile_api_samples(route_class,method,status_code,duration_ms,sample_weight,created_at) VALUES (?,?,?,?,?,?)`)
      .run(row.routeClass,row.method,row.statusCode,row.durationMs,row.sampleWeight,row.now),
    purge:async now=>{await db.prepare('DELETE FROM mobile_api_samples WHERE created_at<?').run(now-7*24*60*60_000);await db.prepare('DELETE FROM mobile_device_health WHERE last_seen_at<?').run(now-45*24*60*60_000);},
  });
}
