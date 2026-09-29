import { check } from '../shared/errors.mjs';

export function createRateLimiter({ db, unitOfWork, digest }) {
  return Object.freeze({
    async consume(key, now, limit, windowMs) {
      const count = await unitOfWork(async () => {
        await db.prepare(`INSERT INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?)
          ON CONFLICT(key) DO UPDATE SET
            count = CASE WHEN rate_limits.reset_at <= ? THEN 1 ELSE rate_limits.count + 1 END,
            reset_at = CASE WHEN rate_limits.reset_at <= ? THEN excluded.reset_at ELSE rate_limits.reset_at END`)
          .run(digest(key), now + windowMs, now, now);
        return (await db.prepare('SELECT count FROM rate_limits WHERE key = ?').get(digest(key))).count;
      });
      check(count <= limit, 'RATE_LIMITED', 'Too many requests. Please try again later.');
    },
    async sweep(now) {
      await db.prepare('DELETE FROM rate_limits WHERE key IN (SELECT key FROM rate_limits WHERE reset_at <= ? ORDER BY reset_at LIMIT 500)').run(now);
    },
  });
}
