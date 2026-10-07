export const DELIVERY_REPORTS = Object.freeze(['recipient_unavailable', 'incorrect_pin', 'damaged_parcel', 'failed_delivery']);
export const DELIVERY_EVENT_LABELS = Object.freeze({
  recipient_unavailable: 'Recipient unavailable', incorrect_pin: 'Handover code needs review',
  damaged_parcel: 'Parcel damage reported', failed_delivery: 'Delivery attempt failed',
  return_requested: 'Return requested', return_authorized: 'Sender authorized return',
  return_received: 'Sender confirmed parcel returned', resolved: 'Issue resolved; delivery may continue',
});

/** Exception progress is separate from trip/payment state; a return is never a successful delivery. */
export function deliveryOperationState(events, tripStatus) {
  let state = 'normal';
  for (const event of events) {
    if (DELIVERY_REPORTS.includes(event.kind)) state = 'exception';
    else if (event.kind === 'return_requested') state = 'return_requested';
    else if (event.kind === 'return_authorized') state = 'return_authorized';
    else if (event.kind === 'return_received') state = 'returned';
    else if (event.kind === 'resolved') state = 'normal';
  }
  if (state === 'returned') return state;
  if (tripStatus === 'completed') return 'delivered';
  if (['cancelled', 'expired'].includes(tripStatus)) return 'closed';
  return state;
}
