import { check } from '../shared/errors.mjs';

/** Native transport only; the location service owns participant privacy and leases. */
export async function mobileTracking({ locations, session, path, write, query, data, key }) {
  const ride = (await path.match(/^\/tracking\/rides\/([a-f0-9-]{36})(\/start)?$/));
  const share = (await path.match(/^\/tracking\/shares\/([a-f0-9-]{36})\/(stop|position)$/));
  check((ride && (write ? ride[2] : !ride[2])) || (share && write), 'NOT_FOUND', 'Tracking endpoint not found.');
  const input = { userId: session.user.id, nativeSessionId: session.id, clientId: (await query.get('clientId')) };
  if (!write) return (await locations.tracking(input, ride[1]));
  if (ride) return (await locations.shareCommand(input, 'start', ride[1], data, key));
  return share[2] === 'stop' ? (await locations.shareCommand(input, 'stop', share[1], data, key)) : (await locations.update(input, share[1], data));
}
