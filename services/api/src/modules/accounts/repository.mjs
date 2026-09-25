/** SQLite adapter. Services consume these operations without receiving a DB. */
export function createAccountsRepository(db) {
  return Object.freeze({
    findById: async (id) => (await db.prepare(`SELECT id, email, name, role, created_at AS createdAt,
      EXISTS(SELECT 1 FROM account_email_verifications v WHERE v.user_id=users.id AND v.email=users.email) AS emailVerified
      FROM users WHERE id = ?`).get(id)) ?? null,
    findByEmail: async (email) => (await db.prepare(`SELECT id, role, password_hash AS passwordHash,
      COALESCE((SELECT enabled FROM account_password_settings WHERE user_id=users.id),1) AS passwordEnabled FROM users WHERE email = ?`).get(email)) ?? null,
    googleOwner: async (subject) => (await db.prepare("SELECT user_id AS userId FROM account_identities WHERE provider='google' AND subject=?").get(subject))?.userId ?? null,
    googleLinked: async (id) => Boolean((await db.prepare("SELECT 1 FROM account_identities WHERE provider='google' AND user_id=?").get(id))),
    linkGoogle: async (id, subject, now) => (await db.prepare("INSERT INTO account_identities(provider,subject,user_id,created_at) VALUES ('google',?,?,?)").run(subject,id,now)),
    unlinkGoogle: async (id) => (await db.prepare("DELETE FROM account_identities WHERE provider='google' AND user_id=?").run(id)),
    hasAdmin: async () => Boolean((await db.prepare("SELECT id FROM users WHERE role = 'admin'").get())),
    capabilities: async (id) => (await db.prepare('SELECT capability FROM account_capabilities WHERE user_id = ? ORDER BY capability')
      .all(id)).map((row) => row.capability),
    grant: async (id, capability, now) => (await db.prepare('INSERT INTO account_capabilities (user_id, capability, created_at) VALUES (?, ?, ?)').run(id, capability, now)),
    revokeCapability: async (id, capability) => (await db.prepare('DELETE FROM account_capabilities WHERE user_id=? AND capability=?').run(id, capability)),
    clearCapabilities: async (id) => (await db.prepare('DELETE FROM account_capabilities WHERE user_id = ?').run(id)),
    findCommand: async (id, key) => (await db.prepare('SELECT fingerprint FROM account_commands WHERE actor_id = ? AND key = ?').get(id, key)),
    saveCommand: async (id, key, fingerprint) => (await db.prepare('INSERT INTO account_commands (actor_id, key, fingerprint) VALUES (?, ?, ?)').run(id, key, fingerprint)),
    async insert({ id, email, name, passwordHash, role, createdAt, passwordEnabled = true }) {
      (await db.prepare('INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, email, name, passwordHash, role, createdAt));
      if (!passwordEnabled) (await db.prepare('INSERT INTO account_password_settings(user_id,enabled) VALUES (?,0)').run(id));
    },
    promoteToAdmin: async (id) => (await db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(id)),
    findSession: async (hash, now) => (await db.prepare('SELECT user_id AS userId, csrf_token AS csrfToken FROM sessions WHERE token_hash = ? AND expires_at > ?')
      .get(hash, now)) ?? null,
    async insertSession({ tokenHash, userId, csrfToken, expiresAt }) {
      (await db.prepare('INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)')
        .run(tokenHash, userId, csrfToken, expiresAt));
    },
    deleteSession: async (hash) => (await db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash)),
    deleteUserSessions: async (id) => (await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id)),
    deleteExpiredSessions: async (now) => (await db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now)),
    confirmEmail: async (id,email,now) => (await db.prepare(`INSERT INTO account_email_verifications(user_id,email,verified_at) VALUES (?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,verified_at=excluded.verified_at`).run(id,email,now)),
    replacePassword: async (id,hash) => (await db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash,id)),
  });
}
