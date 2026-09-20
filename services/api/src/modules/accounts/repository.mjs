/** SQLite adapter. Services consume these operations without receiving a DB. */
export function createAccountsRepository(db) {
  return Object.freeze({
    findById: (id) => db.prepare('SELECT id, email, name, role, created_at AS createdAt FROM users WHERE id = ?').get(id) ?? null,
    findByEmail: (email) => db.prepare('SELECT id, role, password_hash AS passwordHash FROM users WHERE email = ?').get(email) ?? null,
    hasAdmin: () => Boolean(db.prepare("SELECT id FROM users WHERE role = 'admin'").get()),
    capabilities: (id) => db.prepare('SELECT capability FROM account_capabilities WHERE user_id = ? ORDER BY capability')
      .all(id).map((row) => row.capability),
    grant: (id, capability, now) => db.prepare('INSERT INTO account_capabilities (user_id, capability, created_at) VALUES (?, ?, ?)').run(id, capability, now),
    clearCapabilities: (id) => db.prepare('DELETE FROM account_capabilities WHERE user_id = ?').run(id),
    findCommand: (id, key) => db.prepare('SELECT fingerprint FROM account_commands WHERE actor_id = ? AND key = ?').get(id, key),
    saveCommand: (id, key, fingerprint) => db.prepare('INSERT INTO account_commands (actor_id, key, fingerprint) VALUES (?, ?, ?)').run(id, key, fingerprint),
    insert({ id, email, name, passwordHash, role, createdAt }) {
      db.prepare('INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, email, name, passwordHash, role, createdAt);
    },
    promoteToAdmin: (id) => db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(id),
    findSession: (hash, now) => db.prepare('SELECT user_id AS userId, csrf_token AS csrfToken FROM sessions WHERE token_hash = ? AND expires_at > ?')
      .get(hash, now) ?? null,
    insertSession({ tokenHash, userId, csrfToken, expiresAt }) {
      db.prepare('INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)')
        .run(tokenHash, userId, csrfToken, expiresAt);
    },
    deleteSession: (hash) => db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash),
    deleteUserSessions: (id) => db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id),
    deleteExpiredSessions: (now) => db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now),
  });
}
