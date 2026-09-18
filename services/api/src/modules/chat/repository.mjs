const messageColumns = 'id, ride_id AS rideId, sequence, sender_id AS senderId, body, created_at AS createdAt';
const reportColumns = `id, message_id AS messageId, reporter_id AS reporterId, reason,
  status, created_at AS createdAt, reviewed_by AS reviewedBy, reviewed_at AS reviewedAt`;

/** Owns chat tables only. All mutations join the service's unit of work. */
export function createChatRepository(db) {
  return Object.freeze({
    findMessage: (id) => db.prepare(`SELECT ${messageColumns} FROM chat_messages WHERE id = ?`).get(id) ?? null,
    listMessages: (rideId, after, limit) => db.prepare(`SELECT ${messageColumns} FROM chat_messages
      WHERE ride_id = ? AND sequence > ? ORDER BY sequence LIMIT ?`).all(rideId, after, limit),
    latest: (rideId) => db.prepare('SELECT COALESCE(MAX(sequence), 0) AS sequence FROM chat_messages WHERE ride_id = ?').get(rideId).sequence,
    insertMessage({ id, rideId, sequence, senderId, body, createdAt }) {
      db.prepare('INSERT INTO chat_messages (id, ride_id, sequence, sender_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, rideId, sequence, senderId, body, createdAt);
    },
    readThrough: (rideId, userId) => db.prepare('SELECT through_sequence AS sequence FROM chat_reads WHERE ride_id = ? AND user_id = ?')
      .get(rideId, userId)?.sequence ?? 0,
    markRead(rideId, userId, sequence, now) {
      db.prepare(`INSERT INTO chat_reads (ride_id, user_id, through_sequence, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT (ride_id, user_id) DO UPDATE SET through_sequence = MAX(through_sequence, excluded.through_sequence),
        updated_at = excluded.updated_at`).run(rideId, userId, sequence, now);
    },
    unread: (rideId, userId) => db.prepare(`SELECT count(*) AS count FROM chat_messages WHERE ride_id = ? AND sender_id <> ?
      AND sequence > COALESCE((SELECT through_sequence FROM chat_reads WHERE ride_id = ? AND user_id = ?), 0)`)
      .get(rideId, userId, rideId, userId).count,
    findCommand: (actorId, key) => db.prepare('SELECT fingerprint, message_id AS messageId FROM chat_commands WHERE actor_id = ? AND key = ?')
      .get(actorId, key) ?? null,
    saveCommand(actorId, key, fingerprint, messageId) {
      db.prepare('INSERT INTO chat_commands (actor_id, key, fingerprint, message_id) VALUES (?, ?, ?, ?)').run(actorId, key, fingerprint, messageId);
    },
    findReport: (id) => db.prepare(`SELECT ${reportColumns} FROM chat_reports WHERE id = ?`).get(id) ?? null,
    reportFor: (messageId, reporterId) => db.prepare(`SELECT ${reportColumns} FROM chat_reports WHERE message_id = ? AND reporter_id = ?`)
      .get(messageId, reporterId) ?? null,
    reportedMessages: (rideId, reporterId) => db.prepare(`SELECT r.message_id AS id FROM chat_reports r
      JOIN chat_messages m ON m.id = r.message_id WHERE m.ride_id = ? AND r.reporter_id = ?`).all(rideId, reporterId).map((row) => row.id),
    insertReport({ id, messageId, reporterId, reason, createdAt }) {
      db.prepare('INSERT INTO chat_reports (id, message_id, reporter_id, reason, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, messageId, reporterId, reason, createdAt);
    },
    listReports: () => db.prepare(`SELECT ${reportColumns} FROM chat_reports
      ORDER BY status = 'open' DESC, created_at DESC, id LIMIT 100`).all(),
    reviewReport(id, actorId, now) {
      db.prepare("UPDATE chat_reports SET status = 'reviewed', reviewed_by = ?, reviewed_at = ? WHERE id = ? AND status = 'open'")
        .run(actorId, now, id);
    },
  });
}
