import { createHash, randomBytes, randomUUID, randomInt, timingSafeEqual } from 'node:crypto';

export const tokens = Object.freeze({
  digest: (value) => createHash('sha256').update(value).digest('hex'),
  generate: () => randomBytes(32).toString('hex'),
  id: () => randomUUID(),
  pickupPin: () => String(randomInt(0, 1_000_000)).padStart(6, '0'),
  equal(left, right) {
    const a = Buffer.from(left), b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  },
});
