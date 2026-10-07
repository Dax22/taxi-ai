export function createAdminMobileRepository(db){
 const active=`d.revoked_at IS NULL AND d.expires_at>? AND d.idle_expires_at>?`;
 return Object.freeze({
  summary:now=>db.prepare(`SELECT count(*) AS activeDevices,
    sum(CASE WHEN h.session_id IS NOT NULL THEN 1 ELSE 0 END) AS reportingDevices,
    sum(CASE WHEN h.platform='ios' THEN 1 ELSE 0 END) AS iosDevices,
    sum(CASE WHEN h.platform='android' THEN 1 ELSE 0 END) AS androidDevices,
    sum(CASE WHEN p.session_id IS NOT NULL THEN 1 ELSE 0 END) AS pushRegistered
    FROM device_sessions d LEFT JOIN mobile_device_health h ON h.session_id=d.id LEFT JOIN push_registrations p ON p.session_id=d.id WHERE ${active}`).get(now,now),
  devices:(now,limit)=>db.prepare(`SELECT d.id AS sessionId,d.name AS deviceName,d.created_at AS createdAt,d.refreshed_at AS refreshedAt,
    d.expires_at AS expiresAt,d.idle_expires_at AS idleExpiresAt,u.id AS userId,u.name AS userName,u.email,
    h.platform,h.app_version AS appVersion,h.native_build AS nativeBuild,h.eas_build_id AS easBuildId,h.build_profile AS buildProfile,h.git_commit AS gitCommit,
    h.os_version AS osVersion,h.location_permission AS locationPermission,h.background_location_permission AS backgroundLocationPermission,
    h.notification_permission AS notificationPermission,h.first_seen_at AS firstSeenAt,h.last_seen_at AS lastSeenAt,
    CASE WHEN p.session_id IS NULL THEN 0 ELSE 1 END AS pushRegistered,
    CASE WHEN EXISTS(SELECT 1 FROM driver_availability a WHERE a.native_session_id=d.id AND a.active=1 AND a.seen_at>=?) THEN 1 ELSE 0 END AS driverOnline
    FROM device_sessions d JOIN users u ON u.id=d.user_id LEFT JOIN mobile_device_health h ON h.session_id=d.id LEFT JOIN push_registrations p ON p.session_id=d.id
    WHERE ${active} ORDER BY COALESCE(h.last_seen_at,d.refreshed_at) DESC,d.id LIMIT ?`).all(now-120_000,now,now,limit),
  builds:now=>db.prepare(`SELECT h.platform,h.app_version AS appVersion,h.native_build AS nativeBuild,h.eas_build_id AS easBuildId,h.build_profile AS buildProfile,
    h.git_commit AS gitCommit,count(*) AS devices,max(h.last_seen_at) AS lastSeenAt
    FROM mobile_device_health h JOIN device_sessions d ON d.id=h.session_id WHERE ${active}
    GROUP BY h.platform,h.app_version,h.native_build,h.eas_build_id,h.build_profile,h.git_commit ORDER BY h.platform,h.native_build DESC,h.app_version DESC`).all(now,now),
  pushJobs:since=>db.prepare(`SELECT j.status,count(*) AS count,sum(j.attempts) AS attempts FROM push_jobs j JOIN account_notifications n ON n.id=j.notification_id
    WHERE n.created_at>=? GROUP BY j.status ORDER BY j.status`).all(since),
  tracking:async now=>({
    ride:await db.prepare(`SELECT count(*) AS active,
      sum(CASE WHEN seen_at>=? THEN 1 ELSE 0 END) AS healthy,
      sum(CASE WHEN seen_at<? AND seen_at>=? THEN 1 ELSE 0 END) AS stale,
      sum(CASE WHEN seen_at<? THEN 1 ELSE 0 END) AS expired FROM location_shares WHERE active=1`).get(now-30_000,now-30_000,now-60_000,now-60_000),
    food:await db.prepare(`SELECT count(*) AS active,
      sum(CASE WHEN seen_at>=? THEN 1 ELSE 0 END) AS healthy,
      sum(CASE WHEN seen_at<? AND seen_at>=? THEN 1 ELSE 0 END) AS stale,
      sum(CASE WHEN seen_at<? THEN 1 ELSE 0 END) AS expired FROM eats_location_shares WHERE active=1`).get(now-30_000,now-30_000,now-60_000,now-60_000),
    background:(await db.prepare('SELECT count(*) AS n FROM background_location_tokens WHERE expires_at>?').get(now)).n,
  }),
  apiSamples:(since,limit)=>db.prepare(`SELECT route_class AS routeClass,method,status_code AS statusCode,duration_ms AS durationMs,sample_weight AS sampleWeight,created_at AS createdAt
    FROM mobile_api_samples WHERE created_at>=? ORDER BY created_at DESC,id DESC LIMIT ?`).all(since,limit),
  findDevice:id=>db.prepare(`SELECT id AS sessionId,user_id AS userId,name AS deviceName,revoked_at AS revokedAt FROM device_sessions WHERE id=?`).get(id),
  revokeDevice:(id,now)=>db.prepare('UPDATE device_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE id=?').run(now,id),
  unregisterPush:id=>db.prepare('DELETE FROM push_registrations WHERE session_id=?').run(id),
  command:(actor,key)=>db.prepare('SELECT session_id AS sessionId FROM mobile_admin_commands WHERE actor_id=? AND command_key=?').get(actor,key),
  saveCommand:(actor,key,sessionId,now)=>db.prepare('INSERT INTO mobile_admin_commands(actor_id,command_key,session_id,created_at) VALUES (?,?,?,?)').run(actor,key,sessionId,now),
 });
}
