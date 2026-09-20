export const SAFETY_KINDS = Object.freeze({ need_help: 'Need help', possible_crash: 'Possible crash', unsafe_behaviour: 'Unsafe behaviour', other: 'Other concern' });
export const INCIDENT_LABELS = Object.freeze({ open: 'Open test incident', acknowledged: 'Acknowledged by test administrator', resolved: 'Closed by test administrator' });
export const ALERT_LABELS = Object.freeze({ queued: 'Test alert queued', sent: 'Sending simulated', delivered: 'Delivery simulated', failed: 'Test delivery failed', cancelled: 'Test alert cancelled' });
export const MAX_CONTACTS = 3, SHARE_MINUTES = Object.freeze([15, 30, 60]);
export const canUseTripSafety = (status) => ['booked', 'on_way', 'arrived', 'in_progress'].includes(status);
