import { check } from '../shared/errors.mjs';

export function createRateLimiter({ db, unitOfWork, digest }) {
  return Object.freeze({
    consume(key, now, limit, windowMs) {
      const count = unitOfWork(() => {
        db.prepare('DELETE FROM rate_limits WHERE reset_at <= ?').run(now);
        db.prepare(`INSERT INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?)
          ON CONFLICT(key) DO UPDATE SET count = count + 1`).run(digest(key), now + windowMs);
        return db.prepare('SELECT count FROM rate_limits WHERE key = ?').get(digest(key)).count;
      });
      check(count <= limit, 'RATE_LIMITED', 'Too many requests. Please try again later.');
    },
  });
}
