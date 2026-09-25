import { check } from '../../shared/errors.mjs';

/** Supply signal and authorize in HTTP adapters; authorization is checked again after waiting. */
export async function realtimeResponse(service, { userId, query, signal, authorize }) {
  check(typeof authorize === 'function', 'UNAUTHENTICATED', 'Sign in to continue.');
  const body = await service.wait(userId, { ...parseRevisionQuery(query), signal });
  const current = await authorize();
  check(current?.user?.id === userId, 'UNAUTHENTICATED', 'Your session ended. Sign in again.');
  return body;
}

export function requestAbortSignal(response) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  response.once('close', abort);
  return { signal: controller.signal, dispose() { response.removeListener('close', abort); } };
}

export function parseRevisionQuery(query) {
  const cursor = query.get('cursor') ?? '0', rawWait = query.get('wait') ?? '25000';
  check(/^(0|[1-9][0-9]{0,17})$/.test(cursor), 'INVALID_CURSOR', 'Use a valid update cursor.');
  check(/^[0-9]{1,5}$/.test(rawWait) && Number(rawWait) <= 25_000, 'INVALID_WAIT', 'Update wait must be between 0 and 25000 milliseconds.');
  check([...query.keys()].every(key => ['cursor', 'wait'].includes(key)), 'INVALID_FIELDS', 'Only cursor and wait are accepted.');
  return { cursor, waitMs: Number(rawWait) };
}

