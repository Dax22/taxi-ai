import { ApplicationError, check } from '../shared/errors.mjs';

export async function readBody(request, maxBytes = 16_384) {
  check(/^application\/json(?:\s*;.*)?$/i.test(request.headers['content-type'] ?? ''),
    'JSON_REQUIRED', 'Use application/json.');
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes <= maxBytes) chunks.push(chunk);
  }
  check(bytes <= maxBytes, 'BODY_TOO_LARGE', 'The request is too large.');
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ApplicationError('INVALID_JSON', 'Send valid JSON.'); }
}
