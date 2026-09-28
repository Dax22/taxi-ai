import { check } from '../../shared/errors.mjs';

async function reply(context, run) {
  check(!context.query || [...context.query.keys()].length === 0, 'INVALID_FIELDS', 'Parcel tracking does not accept query parameters.');
  const body = await run(), fresh = await context.reauthenticate();
  check(fresh?.id === context.user.id, 'UNAUTHENTICATED', 'Sign in to continue.');
  return { body };
}
export function parcelTrackingRoutes(parcels) {
  return [
    { method: 'GET', path: /^\/api\/parcels\/received$/, access: 'read', handle: context => reply(context, () => parcels.list(context.user.id)) },
    { method: 'GET', path: /^\/api\/parcels\/received\/([a-f0-9-]{36})$/, access: 'read', handle: context => reply(context, () => parcels.received(context.user.id, context.match[1])) },
    { method: 'GET', path: /^\/api\/parcels\/([a-f0-9-]{36})\/invitation$/, access: 'read', handle: context => reply(context, () => parcels.get(context.user.id, context.match[1])) },
    { method: 'POST', path: /^\/api\/parcels\/accept$/, access: 'write', handle: context => reply(context, () => parcels.command({ userId: context.user.id, action: 'accept', data: context.data, key: context.key })) },
    { method: 'POST', path: /^\/api\/parcels\/([a-f0-9-]{36})\/(link|revoke)$/, access: 'write', handle: context => reply(context, () => parcels.command({ userId: context.user.id, rideId: context.match[1], action: context.match[2], data: context.data, key: context.key })) },
  ];
}
