// Review-only observations. A missing GPS update may be a network, battery or
// permission problem; no signal establishes an off-platform trip or misconduct.
export const GAP_AFTER_ARRIVAL_MS = 120_000;
export const LOCATION_STALE_MS = 90_000;
export const ARRIVAL_LOCATION_TOLERANCE_MS = 30_000;

export const SIGNAL_KINDS = Object.freeze({
  tracking_gap_after_arrival: 'GPS updates stopped after recorded pickup arrival',
  cancelled_after_arrival: 'Ride cancelled after recorded pickup arrival',
});

export function arrivalGap(candidate, now) {
  if (candidate.status !== 'arrived' || !Number.isSafeInteger(candidate.arrivedAt)
    || !Number.isSafeInteger(candidate.lastLocationAt) || !Number.isSafeInteger(now)) return null;
  const { arrivedAt, lastLocationAt } = candidate;
  if (arrivedAt > now || now - arrivedAt < GAP_AFTER_ARRIVAL_MS
    || lastLocationAt < arrivedAt - ARRIVAL_LOCATION_TOLERANCE_MS
    || lastLocationAt > now - LOCATION_STALE_MS) return null;
  return { kind: 'tracking_gap_after_arrival', arrivedAt, lastLocationAt };
}

export function arrivalCancellation(candidate) {
  if (candidate.status !== 'cancelled' || !Number.isSafeInteger(candidate.arrivedAt)
    || candidate.startedAt !== null && candidate.startedAt !== undefined
    || !Number.isSafeInteger(candidate.cancelledAt) || candidate.cancelledAt < candidate.arrivedAt) return null;
  return { kind: 'cancelled_after_arrival', arrivedAt: candidate.arrivedAt,
    lastLocationAt: null, cancellationActorId: candidate.cancellationActorId ?? null,
    cancellationReason: candidate.cancellationReason ?? null };
}
