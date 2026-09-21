/** Storage for email actions. Account credentials remain in the accounts module. */
export function createAccountEmailRepository(db) {
  return Object.freeze({
    countJobs: () => db.prepare('SELECT count(*) AS n FROM account_email_jobs').get().n,
    enqueue: (id, userId, purpose, email, now) => db.prepare(`INSERT OR IGNORE INTO account_email_jobs
      (id,user_id,purpose,email,created_at,next_attempt_at) VALUES (?,?,?,?,?,?)`).run(id,userId,purpose,email,now,now),
    due: (now) => db.prepare(`SELECT id,user_id AS userId,purpose,email,created_at AS createdAt,attempts
      FROM account_email_jobs WHERE next_attempt_at<=? AND lease_until<=? ORDER BY next_attempt_at,id LIMIT 1`).get(now,now),
    claim: (id, lease, now) => db.prepare('UPDATE account_email_jobs SET attempts=attempts+1,lease_id=?,lease_until=? WHERE id=?')
      .run(lease,now+60_000,id),
    owns: (id, lease) => Boolean(db.prepare('SELECT 1 FROM account_email_jobs WHERE id=? AND lease_id=?').get(id,lease)),
    deleteJob: (id) => db.prepare('DELETE FROM account_email_jobs WHERE id=?').run(id),
    retry: (id, when) => db.prepare('UPDATE account_email_jobs SET next_attempt_at=?,lease_id=NULL,lease_until=0 WHERE id=?').run(when,id),
    deleteUserJobs: (id) => db.prepare('DELETE FROM account_email_jobs WHERE user_id=?').run(id),
    putToken({ hash, userId, purpose, email, credentialHash, expiresAt }) {
      db.prepare('DELETE FROM account_email_tokens WHERE user_id=? AND purpose=?').run(userId,purpose);
      db.prepare('INSERT INTO account_email_tokens(token_hash,user_id,purpose,email,credential_hash,expires_at) VALUES (?,?,?,?,?,?)')
        .run(hash,userId,purpose,email,credentialHash,expiresAt);
    },
    token: (hash, purpose, now) => db.prepare(`SELECT user_id AS userId,email,credential_hash AS credentialHash
      FROM account_email_tokens WHERE token_hash=? AND purpose=? AND expires_at>?`).get(hash,purpose,now),
    deleteToken: (hash) => db.prepare('DELETE FROM account_email_tokens WHERE token_hash=?').run(hash),
    deleteUserTokens: (id) => db.prepare('DELETE FROM account_email_tokens WHERE user_id=?').run(id),
    sweep: (now) => db.prepare('DELETE FROM account_email_tokens WHERE expires_at<=?').run(now),
  });
}
