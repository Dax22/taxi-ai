const sessionCols = 'owner_id AS ownerId,ride_id AS rideId,binding,enabled,preferences_json AS preferencesJson,version,expires_at AS expiresAt';
const alertCols = 'id,owner_id AS ownerId,ride_id AS rideId,kind,signal_json AS signalJson,snapshot_json AS snapshotJson,status,created_at AS createdAt,due_at AS dueAt,version';
const jobCols = 'id,alert_id AS alertId,contact_id AS contactId,recipient_json AS recipientJson,status,attempts,next_at AS nextAt,lease_until AS leaseUntil';
const zoneCols = 'id,reporter_id AS reporterId,label,lat,lng,radius_m AS radiusM,note,status,created_at AS createdAt,expires_at AS expiresAt,version,review_note AS reviewNote,reviewer_id AS reviewerId';
export function createSafetyMonitoringRepository(db) {
  return {
    session: (owner, ride) => db.prepare(`SELECT ${sessionCols} FROM safety_monitor_sessions WHERE owner_id=? AND ride_id=?`).get(owner, ride),
    saveSession(owner, ride, binding, prefs, now) { db.prepare(`INSERT INTO safety_monitor_sessions(owner_id,ride_id,binding,enabled,preferences_json,expires_at,version)
      VALUES (?,?,?,?,?,?,1) ON CONFLICT(owner_id,ride_id) DO UPDATE SET binding=excluded.binding,enabled=excluded.enabled,preferences_json=excluded.preferences_json,version=version+1,expires_at=excluded.expires_at`)
      .run(owner, ride, binding, Number(prefs.enabled), JSON.stringify(prefs), now + 45_000); },
    heartbeat(owner, ride, now) { db.prepare('UPDATE safety_monitor_sessions SET expires_at=? WHERE owner_id=? AND ride_id=?').run(now + 45_000, owner, ride); },
    contact: id => db.prepare('SELECT id,owner_id AS ownerId,name,phone,version,active FROM trusted_contacts WHERE id=?').get(id),
    alerts: (owner, ride) => db.prepare(`SELECT ${alertCols} FROM safety_auto_alerts WHERE owner_id=? AND ride_id=? ORDER BY created_at DESC,id LIMIT 20`).all(owner, ride),
    alert: id => db.prepare(`SELECT ${alertCols} FROM safety_auto_alerts WHERE id=?`).get(id),
    activeAlert: (owner, ride) => db.prepare(`SELECT ${alertCols} FROM safety_auto_alerts WHERE owner_id=? AND ride_id=? AND status IN ('countdown','queued')`).get(owner, ride),
    recentCount: (owner, ride, now) => db.prepare('SELECT count(*) AS n FROM safety_auto_alerts WHERE owner_id=? AND ride_id=? AND created_at>?').get(owner, ride, now - 3600_000).n,
    addAlert(a) { db.prepare(`INSERT INTO safety_auto_alerts(id,owner_id,ride_id,kind,signal_json,snapshot_json,status,created_at,due_at) VALUES (?,?,?,?,?,?,'countdown',?,?)`)
      .run(a.id, a.ownerId, a.rideId, a.kind, JSON.stringify(a.signal), JSON.stringify(a.snapshot), a.now, a.dueAt); },
    transition(id, status) { db.prepare('UPDATE safety_auto_alerts SET status=?,version=version+1 WHERE id=?').run(status, id); },
    due: now => db.prepare(`SELECT ${alertCols} FROM safety_auto_alerts WHERE status='countdown' AND due_at<=? ORDER BY due_at LIMIT 100`).all(now),
    jobs: id => db.prepare(`SELECT ${jobCols} FROM safety_delivery_jobs WHERE alert_id=? ORDER BY id`).all(id),
    addJob(id, alert, contact, recipient, now, available) { db.prepare(`INSERT INTO safety_delivery_jobs(id,alert_id,contact_id,recipient_json,status,next_at) VALUES (?,?,?,?,?,?)`)
      .run(id, alert, contact, JSON.stringify(recipient), available ? 'queued' : 'unavailable', now); },
    cancelJobs(id) { db.prepare("UPDATE safety_delivery_jobs SET status='cancelled' WHERE alert_id=? AND status IN ('queued','failed')").run(id); },
    pending: now => db.prepare(`SELECT ${jobCols} FROM safety_delivery_jobs WHERE (status='queued' AND next_at<=?) OR (status='sending' AND lease_until<=?) ORDER BY next_at LIMIT 20`).all(now, now),
    claim(id, now) { return db.prepare("UPDATE safety_delivery_jobs SET status='sending',attempts=attempts+1,lease_until=? WHERE id=? AND ((status='queued' AND next_at<=?) OR (status='sending' AND lease_until<=?))").run(now + 30_000, id, now, now).changes > 0; },
    jobState(id, status, nextAt, reference = null) { db.prepare('UPDATE safety_delivery_jobs SET status=?,next_at=?,lease_until=0,provider_reference=? WHERE id=?').run(status, nextAt, reference, id); },
    finishAlerts() { db.exec("UPDATE safety_auto_alerts SET status='finished',version=version+1 WHERE status='queued' AND NOT EXISTS(SELECT 1 FROM safety_delivery_jobs WHERE alert_id=safety_auto_alerts.id AND status IN ('queued','sending'))"); },
    command: (owner, key) => db.prepare('SELECT fingerprint FROM safety_monitor_commands WHERE owner_id=? AND key=?').get(owner,key),
    saveCommand(owner,key,fingerprint) { db.prepare('INSERT INTO safety_monitor_commands VALUES (?,?,?)').run(owner,key,fingerprint); },
    approved: now => db.prepare(`SELECT ${zoneCols} FROM safety_risk_zones WHERE status='approved' AND expires_at>?`).all(now),
    zones: () => db.prepare(`SELECT ${zoneCols} FROM safety_risk_zones ORDER BY created_at DESC,id LIMIT 100`).all(),
    zone: id => db.prepare(`SELECT ${zoneCols} FROM safety_risk_zones WHERE id=?`).get(id),
    zoneCount: (owner, now) => db.prepare('SELECT count(*) AS n FROM safety_risk_zones WHERE reporter_id=? AND created_at>?').get(owner, now - 86400_000).n,
    addZone(id, owner, d, now) { db.prepare("INSERT INTO safety_risk_zones(id,reporter_id,label,lat,lng,radius_m,note,status,created_at,expires_at) VALUES (?,?,?,?,?,?,?,'pending',?,?)")
      .run(id,owner,d.label,d.lat,d.lng,d.radiusM,d.note,now,now+86400_000); },
    reviewZone(id,owner,d) { db.prepare('UPDATE safety_risk_zones SET status=?,review_note=?,reviewer_id=?,expires_at=?,version=version+1 WHERE id=?').run(d.status,d.note,owner,d.expiresAt,id); },
  };
}
