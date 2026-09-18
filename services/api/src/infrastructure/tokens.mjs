import { createHash, randomBytes, randomUUID } from 'node:crypto';

export const tokens = Object.freeze({
  digest: (value) => createHash('sha256').update(value).digest('hex'),
  generate: () => randomBytes(32).toString('hex'),
  id: () => randomUUID(),
});
