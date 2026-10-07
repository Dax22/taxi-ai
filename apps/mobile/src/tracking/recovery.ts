/** Retry only transport/service failures; invalid authority and malformed replies fail closed. */
export function retryableLocationFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { status, code, message } = error as { status?: number; code?: string; message?: string };
  if (status !== undefined) return [408, 425, 429].includes(status) || status >= 500 && status <= 599;
  // Compatibility with the existing headless transport, which emits this exact
  // sanitized error for fetch failures and timeouts (never arbitrary OS errors).
  return ['CONNECTION_INTERRUPTED', 'NETWORK_ERROR', 'REQUEST_TIMEOUT'].includes(code ?? '')
    || message === 'Background location connection interrupted.';
}

/** Backoff runs on fresh OS callbacks, never on a queue of old coordinates. */
export function locationRetryDelay(failures: number, error: unknown): number {
  const requested = (error as { retryAfterMs?: number } | null)?.retryAfterMs;
  const backoff = Math.min(20_000, 5000 * 2 ** Math.min(3, Math.max(0, failures - 1)));
  return Number.isFinite(requested) && Number(requested) >= 0
    ? Math.max(backoff, Math.min(60_000, Number(requested))) : backoff;
}
