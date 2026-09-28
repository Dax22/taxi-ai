export function createGoogleAuthRepository(db) {
  return Object.freeze({
    async insert(a) { (await db.prepare(`INSERT INTO google_auth_attempts
      (state_hash,binding_hash,nonce,verifier,channel,intent,origin,actor_id,session_hash,signup_intent,expires_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(a.stateHash,a.bindingHash,a.nonce,a.verifier ?? null,a.channel,a.intent,
      a.origin ?? null,a.actorId ?? null,a.sessionHash ?? null,a.signupIntent ?? null,a.expiresAt)); },
    find: async (hash) => (await db.prepare(`SELECT state_hash AS stateHash,binding_hash AS bindingHash,nonce,verifier,channel,intent,
      origin,actor_id AS actorId,session_hash AS sessionHash,signup_intent AS signupIntent,expires_at AS expiresAt
      FROM google_auth_attempts WHERE state_hash=?`).get(hash)),
    remove: async (hash) => (await db.prepare('DELETE FROM google_auth_attempts WHERE state_hash=?').run(hash)),
    replaceBinding: async (hash) => (await db.prepare("DELETE FROM google_auth_attempts WHERE channel='web' AND binding_hash=?").run(hash)),
    count: async () => (await db.prepare('SELECT count(*) AS n FROM google_auth_attempts').get()).n,
    purge: async (now) => (await db.prepare('DELETE FROM google_auth_attempts WHERE expires_at<=?').run(now)),
  });
}
