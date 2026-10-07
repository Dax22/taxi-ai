import { check } from '../../shared/errors.mjs';
export function deliveryOperationsRoutes(service) {
  return ['GET', 'POST'].map(method => ({ method, path: /^\/api\/parcels\/([a-f0-9-]{36})\/operations$/,
    access: method === 'POST' ? 'write' : 'read',
    async handle(ctx) {
      check(!ctx.query || [...ctx.query.keys()].length === 0, 'INVALID_FIELDS', 'Delivery operations do not accept query parameters.');
      const body = method === 'GET' ? await service.get(ctx.user.id, ctx.match[1])
        : await service.command({ userId: ctx.user.id, rideId: ctx.match[1], data: ctx.data, key: ctx.key });
      const fresh = await ctx.reauthenticate();
      check(fresh?.id === ctx.user.id, 'UNAUTHENTICATED', 'Sign in again.');
      return { body };
    },
  }));
}
