/** Storage for email actions. Account credentials remain in the accounts module. */
export function createAccountEmailRepository(db) {
  return Object.freeze({
    countJobs: async () => (await db.prepare('SELECT count(*) AS n FROM account_email_jobs').get()).n,
    enqueue: async (id, userId, purpose, email, now) => (await db.prepare(`INSERT OR IGNORE INTO account_email_jobs
      (id,user_id,purpose,email,created_at,next_attempt_at) VALUES (?,?,?,?,?,?)`).run(id,userId,purpose,email,now,now)),
    due: async (now) => (await db.prepare(`SELECT id,user_id AS userId,purpose,email,created_at AS createdAt,attempts
      FROM account_email_jobs WHERE next_attempt_at<=? AND lease_until<=? ORDER BY next_attempt_at,id LIMIT 1`).get(now,now)),
    claim: async (id, lease, now) => (await db.prepare('UPDATE account_email_jobs SET attempts=attempts+1,lease_id=?,lease_until=? WHERE id=? AND lease_until<=? AND next_attempt_at<=?')
      .run(lease,now+60_000,id,now,now)).changes > 0,
    owns: async (id, lease) => Boolean((await db.prepare('SELECT 1 FROM account_email_jobs WHERE id=? AND lease_id=?').get(id,lease))),
    deleteJob: async (id) => (await db.prepare('DELETE FROM account_email_jobs WHERE id=?').run(id)),
    retry: async (id, when) => (await db.prepare('UPDATE account_email_jobs SET next_attempt_at=?,lease_id=NULL,lease_until=0 WHERE id=?').run(when,id)),
    deleteUserJobs: async (id) => (await db.prepare('DELETE FROM account_email_jobs WHERE user_id=?').run(id)),
    async putToken({ hash, userId, purpose, email, credentialHash, expiresAt }) {
      (await db.prepare('DELETE FROM account_email_tokens WHERE user_id=? AND purpose=?').run(userId,purpose));
      (await db.prepare('INSERT INTO account_email_tokens(token_hash,user_id,purpose,email,credential_hash,expires_at) VALUES (?,?,?,?,?,?)')
        .run(hash,userId,purpose,email,credentialHash,expiresAt));
    },
    token: async (hash, purpose, now) => (await db.prepare(`SELECT user_id AS userId,email,credential_hash AS credentialHash
      FROM account_email_tokens WHERE token_hash=? AND purpose=? AND expires_at>?`).get(hash,purpose,now)),
    deleteToken: async (hash) => (await db.prepare('DELETE FROM account_email_tokens WHERE token_hash=?').run(hash)),
    deleteUserTokens: async (id) => (await db.prepare('DELETE FROM account_email_tokens WHERE user_id=?').run(id)),
    sweep: async (now) => (await db.prepare('DELETE FROM account_email_tokens WHERE expires_at<=?').run(now)),
  });
}
