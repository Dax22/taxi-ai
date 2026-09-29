export const safetyTime = (value) => new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Africa/Lagos' }).format(new Date(value));
export const safetyLocation = (value) => value
  ? `${value.lat.toFixed(6)}, ${value.lng.toFixed(6)} · accuracy ±${Math.round(value.accuracy)} m · captured ${safetyTime(value.capturedAt)} (WAT)${value.stale ? ' · stale update' : ''} · driver-shared location`
  : 'No shared location available. No location has been inferred.';
