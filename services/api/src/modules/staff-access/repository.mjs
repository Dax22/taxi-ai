/** Staff persistence. Audit records have an insert/read surface only. */
export function createStaffAccessRepository(db) {
  const memberColumns = 'user_id AS userId, role, status, version, updated_at AS updatedAt';
  return Object.freeze({
    membership: async (userId) => (await db.prepare(`SELECT ${memberColumns} FROM staff_memberships WHERE user_id=?`).get(userId)) ?? null,
    async ensureLegacyOwner(userId, now) {
      await db.prepare(`INSERT INTO staff_memberships(user_id,role,status,version,updated_at)
        SELECT id,'owner','active',1,? FROM users WHERE id=? AND role='admin'
        ON CONFLICT(user_id) DO NOTHING`).run(now,userId);
    },
    async saveMembership(userId, role, status, expectedVersion, now) {
      if (expectedVersion === 0) return Number((await db.prepare(`INSERT INTO staff_memberships(user_id,role,status,version,updated_at)
        VALUES (?,?,?,1,?) ON CONFLICT(user_id) DO NOTHING`).run(userId,role,status,now)).changes) === 1;
      return Number((await db.prepare(`UPDATE staff_memberships SET role=?,status=?,version=version+1,updated_at=?
        WHERE user_id=? AND version=?`).run(role,status,now,userId,expectedVersion)).changes) === 1;
    },
    ownerCount: async () => Number((await db.prepare(`SELECT COUNT(*) AS count FROM users u LEFT JOIN staff_memberships m ON m.user_id=u.id
      WHERE (m.status='active' AND m.role='owner') OR (m.user_id IS NULL AND u.role='admin')`).get()).count),
    staff: async () => await db.prepare(`SELECT u.id AS userId,u.name,u.email,u.role AS accountRole,
      COALESCE(m.role,'owner') AS role,COALESCE(m.status,'active') AS status,COALESCE(m.version,1) AS version,
      COALESCE(m.updated_at,u.created_at) AS updatedAt,EXISTS(SELECT 1 FROM staff_mfa f WHERE f.user_id=u.id) AS mfaEnrolled
      FROM users u LEFT JOIN staff_memberships m ON m.user_id=u.id
      WHERE m.user_id IS NOT NULL OR u.role='admin' ORDER BY CASE WHEN COALESCE(m.status,'active')='active' THEN 0 ELSE 1 END,u.name,u.id LIMIT 500`).all(),
    eligible: async () => await db.prepare(`SELECT u.id,u.name,COALESCE(m.role,'owner') AS role
      FROM users u LEFT JOIN staff_memberships m ON m.user_id=u.id
      WHERE m.status='active' OR (m.user_id IS NULL AND u.role='admin') ORDER BY u.name,u.id LIMIT 500`).all(),
    findCommand: async (userId,key) => (await db.prepare('SELECT fingerprint FROM staff_commands WHERE actor_id=? AND key=?').get(userId,key)) ?? null,
    saveCommand: async (userId,key,fingerprint) => await db.prepare('INSERT INTO staff_commands(actor_id,key,fingerprint) VALUES (?,?,?)').run(userId,key,fingerprint),
    record: async (actorId,action,subjectId,detail,now) => await db.prepare(`INSERT INTO staff_access_audit(actor_id,action,subject_id,detail,created_at)
      VALUES (?,?,?,?,?)`).run(actorId,action,subjectId,JSON.stringify(detail),now),
    async audit({before,limit,q}) {
      const needle = `%${q.toLowerCase().replace(/[\\%_]/g, (value) => `\\${value}`)}%`;
      return await db.prepare(`SELECT a.id,a.actor_id AS actorId,u.name AS actorName,a.kind AS action,a.subject_id AS subjectId,
        s.name AS subjectName,COALESCE((SELECT sa.detail FROM staff_access_audit sa WHERE sa.actor_id=a.actor_id
          AND sa.subject_id=a.subject_id AND sa.action=a.kind AND sa.created_at=a.created_at ORDER BY sa.id DESC LIMIT 1),'{}') AS detail,
        a.created_at AS createdAt FROM audit_events a JOIN users u ON u.id=a.actor_id LEFT JOIN users s ON s.id=a.subject_id
        WHERE a.id<? AND (u.role='admin' OR ((a.kind LIKE 'admin.%' OR a.kind LIKE 'staff.%')
          AND EXISTS(SELECT 1 FROM staff_memberships m WHERE m.user_id=a.actor_id)))
        AND LOWER(u.name || ' ' || a.kind || ' ' || COALESCE(s.name,'') || ' ' || a.subject_id || ' ' ||
          COALESCE((SELECT sa.detail FROM staff_access_audit sa WHERE sa.actor_id=a.actor_id AND sa.subject_id=a.subject_id
            AND sa.action=a.kind AND sa.created_at=a.created_at ORDER BY sa.id DESC LIMIT 1),'')) LIKE ? ESCAPE '\\'
        ORDER BY a.id DESC LIMIT ?`).all(before,needle,limit+1);
    },
    factor: async (userId) => (await db.prepare(`SELECT secret_encrypted AS secretEncrypted,enabled_at AS enabledAt,last_counter AS lastCounter,
      version FROM staff_mfa WHERE user_id=?`).get(userId)) ?? null,
    pending: async (userId) => (await db.prepare(`SELECT session_hash AS sessionHash,secret_encrypted AS secretEncrypted,expires_at AS expiresAt
      FROM staff_mfa_pending WHERE user_id=?`).get(userId)) ?? null,
    savePending: async (userId,sessionHash,secretEncrypted,expiresAt) => await db.prepare(`INSERT INTO staff_mfa_pending(user_id,session_hash,secret_encrypted,expires_at)
      VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET session_hash=excluded.session_hash,secret_encrypted=excluded.secret_encrypted,expires_at=excluded.expires_at`)
      .run(userId,sessionHash,secretEncrypted,expiresAt),
    removePending: async (userId) => await db.prepare('DELETE FROM staff_mfa_pending WHERE user_id=?').run(userId),
    async enableFactor(userId,secretEncrypted,now,counter) {
      return Number((await db.prepare(`INSERT INTO staff_mfa(user_id,secret_encrypted,enabled_at,last_counter,version)
        VALUES (?,?,?,?,1) ON CONFLICT(user_id) DO NOTHING`).run(userId,secretEncrypted,now,counter)).changes)===1;
    },
    async useCounter(userId,counter,version) {
      return Number((await db.prepare('UPDATE staff_mfa SET last_counter=? WHERE user_id=? AND last_counter<? AND version=?').run(counter,userId,counter,version)).changes)===1;
    },
    stepup: async (hash,userId,now) => (await db.prepare(`SELECT verified_until AS verifiedUntil,factor_version AS factorVersion,membership_version AS membershipVersion
      FROM staff_stepups WHERE session_hash=? AND user_id=? AND verified_until>?`).get(hash,userId,now)) ?? null,
    saveStepup: async (hash,userId,until,factorVersion,membershipVersion) => await db.prepare(`INSERT INTO staff_stepups(session_hash,user_id,verified_until,factor_version,membership_version)
      VALUES (?,?,?,?,?) ON CONFLICT(session_hash) DO UPDATE SET user_id=excluded.user_id,verified_until=excluded.verified_until,
      factor_version=excluded.factor_version,membership_version=excluded.membership_version`).run(hash,userId,until,factorVersion,membershipVersion),
    clearStepups: async (userId) => await db.prepare('DELETE FROM staff_stepups WHERE user_id=?').run(userId),
  });
}
