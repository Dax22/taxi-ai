import { fields } from '../../shared/validation.mjs';

/** Customer updates share the normal authenticated/CSRF-protected HTTP surface. */
export function deliveryUpdateRoutes(deliveryUpdates) {
  return [
    { method: 'GET', path: /^\/api\/delivery-updates$/,
      handle: async ({ user, query }) => ({ body: await deliveryUpdates.list(user.id, query.get('before')) }) },
    { method: 'GET', path: /^\/api\/delivery-updates\/(food|parcel)\/([a-f0-9-]{36})$/,
      handle: async ({ user, match }) => ({ body: { update: await deliveryUpdates.forTarget(user.id, match[1], match[2]) } }) },
    { method: 'POST', path: /^\/api\/delivery-updates\/([a-f0-9-]{36})\/open$/, access: 'write',
      handle: async ({ user, match, data }) => {
        fields(data, []);
        return { body: await deliveryUpdates.open(user.id, match[1]) };
      } },
  ];
}
