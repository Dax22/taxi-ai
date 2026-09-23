import { check } from '../shared/errors.mjs';

export function mobileGuestRides({ guestRides, session, path, write, data, key }) {
  const match = path.match(/^\/guest-rides\/([a-f0-9-]{36})(?:\/(link|revoke))?$/);
  check(match, 'NOT_FOUND', 'Guest ride endpoint not found.');
  if (!write && !match[2]) return guestRides.get(session.user.id, match[1]);
  if (write && match[2]) return guestRides.command({ userId: session.user.id, nativeSessionId: session.id, rideId: match[1], action: match[2], data, key });
  check(false, 'NOT_FOUND', 'Guest ride endpoint not found.');
}
