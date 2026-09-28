const columns = `id, ride_id AS rideId, caller_id AS callerId, callee_id AS calleeId, status, mode, version,
  created_at AS createdAt, answered_at AS answeredAt, connected_at AS connectedAt, ended_at AS endedAt,
  ended_by AS endedBy, reason, caller_session AS callerSession, callee_session AS calleeSession,
  caller_client AS callerClient, callee_client AS calleeClient, caller_seen_at AS callerSeenAt,
  callee_seen_at AS calleeSeenAt, caller_connected AS callerConnected, callee_connected AS calleeConnected,
  offer_sdp AS offerSdp, answer_sdp AS answerSdp`;
const active = "status IN ('ringing', 'connecting', 'connected')";

/** Owns call metadata, temporary SDP, active-participant locks and retry keys. */
export function createCallsRepository(db) {
  return Object.freeze({
    find: async (id) => (await db.prepare(`SELECT ${columns} FROM voice_calls WHERE id = ?`).get(id)) ?? null,
    active: async () => (await db.prepare(`SELECT ${columns} FROM voice_calls WHERE ${active}`).all()),
    recent: async (userId) => (await db.prepare(`SELECT ${columns} FROM voice_calls WHERE caller_id = ? OR callee_id = ?
      ORDER BY (${active}) DESC, created_at DESC, id DESC LIMIT 11`).all(userId, userId)),
    busy: async (userId) => Boolean((await db.prepare('SELECT 1 FROM voice_participants WHERE user_id = ?').get(userId))),
    countActive: async () => (await db.prepare('SELECT count(*) AS n FROM voice_participants').get()).n / 2,
    recentStarts: async (userId, since) => (await db.prepare('SELECT count(*) AS n FROM voice_calls WHERE caller_id = ? AND created_at > ?').get(userId, since)).n,
    async insert({ id, rideId, callerId, calleeId, mode, sessionHash, clientHash, now }) {
      (await db.prepare(`INSERT INTO voice_calls (id, ride_id, caller_id, callee_id, mode, status, created_at,
        caller_session, caller_client, caller_seen_at) VALUES (?, ?, ?, ?, ?, 'ringing', ?, ?, ?, ?)`)
        .run(id, rideId, callerId, calleeId, mode, now, sessionHash, clientHash, now));
      const lock = db.prepare('INSERT INTO voice_participants (user_id, call_id) VALUES (?, ?)');
      (await lock.run(callerId, id)); (await lock.run(calleeId, id));
    },
    async accept(id, sessionHash, clientHash, now) {
      (await db.prepare(`UPDATE voice_calls SET status = 'connecting', version = version + 1,
        answered_at = ?, callee_seen_at = ?, callee_session = ?, callee_client = ? WHERE id = ?`)
        .run(now, now, sessionHash, clientHash, id));
    },
    async close(id, status, reason, userId, now) {
      (await db.prepare(`UPDATE voice_calls SET status = ?, reason = ?, ended_by = ?, ended_at = ?, version = version + 1,
        offer_sdp = NULL, answer_sdp = NULL, caller_session = '', callee_session = NULL,
        caller_client = '', callee_client = NULL WHERE id = ?`).run(status, reason, userId, now, id));
      (await db.prepare('DELETE FROM voice_participants WHERE call_id = ?').run(id));
    },
    async signal(id, type, sdp) {
      const column = type === 'offer' ? 'offer_sdp' : 'answer_sdp';
      (await db.prepare(`UPDATE voice_calls SET ${column} = ? WHERE id = ?`).run(sdp, id));
    },
    async pulse(id, caller, connected, now) {
      const side = caller ? 'caller' : 'callee';
      (await db.prepare(`UPDATE voice_calls SET ${side}_seen_at = ?, ${side}_connected = ? WHERE id = ?`).run(now, Number(connected), id));
      return (await db.prepare(`UPDATE voice_calls SET status = 'connected', connected_at = ?, version = version + 1
        WHERE id = ? AND status = 'connecting' AND caller_connected = 1 AND callee_connected = 1
        AND offer_sdp IS NOT NULL AND answer_sdp IS NOT NULL`).run(now, id)).changes === 1;
    },
    command: async (actorId, key) => (await db.prepare('SELECT fingerprint, call_id AS callId FROM voice_commands WHERE actor_id = ? AND key = ?')
      .get(actorId, key)) ?? null,
    async saveCommand(actorId, key, fingerprint, callId) {
      (await db.prepare('INSERT INTO voice_commands (actor_id, key, fingerprint, call_id) VALUES (?, ?, ?, ?)').run(actorId, key, fingerprint, callId));
    },
  });
}
