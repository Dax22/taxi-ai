/** Both authenticated transports call these adapters; authorization stays in Eats. */
export function eatsRoutes(eats) {
  const root = '/api/eats', uuid = '([a-f0-9-]{36})';
  return [
    { method: 'GET', path: /^\/api\/eats\/restaurants$/, handle: async ({ user, query }) => ({ body: (await eats.catalog(user, Object.fromEntries(query))) }) },
    { method: 'GET', path: /^\/api\/eats\/foods$/, handle: async ({ user, query }) => ({ body: (await eats.foods(user, Object.fromEntries(query))) }) },
    { method: 'GET', path: new RegExp(`^${root}/restaurants/${uuid}$`), handle: async ({ user, match }) => ({ body: (await eats.restaurant(user, match[1])) }) },
    { method: 'GET', path: /^\/api\/eats\/store$/, handle: async ({ user }) => ({ body: (await eats.mine(user)) }) },
    { method: 'GET', path: new RegExp(`^${root}/images/${uuid}$`), handle: async ({ user, match }) => ({ image: (await eats.image(user, match[1])) }) },
    { method: 'GET', path: /^\/api\/eats\/admin\/stores$/, handle: async ({ user }) => ({ body: (await eats.reviewList(user)) }) },
    { method: 'GET', path: /^\/api\/eats\/work$/, handle: async ({ user }) => ({ body: (await eats.work(user)) }) },
    { method: 'GET', path: /^\/api\/eats\/orders$/, handle: async ({ user, query }) => ({ body: (await eats.orders(user, query.get('scope') ?? 'customer', query.get('before'))) }) },
    { method: 'GET', path: new RegExp(`^${root}/orders/${uuid}$`), handle: async ({ user, match }) => ({ body: (await eats.order(user, match[1])) }) },
    { method: 'GET', path: new RegExp(`^${root}/photos/${uuid}$`), handle: async ({ user, match }) => ({ body: (await eats.photo(user, match[1])) }) },
    { method: 'POST', path: new RegExp(`^${root}/stores/${uuid}/menu$`), maxBodyBytes: 2_800_000, handle: async ({ user, match, data, key, reauthenticate }) => ({ body: await eats.saveMenu(user, match[1], data, key, reauthenticate) }) },
    ...[['stores', 'store-create'], ['quotes', 'quote'], ['orders', 'place'], ['checkouts', 'meal-quote'], ['checkouts/place', 'meal-place']].map(([path, action]) => ({ method: 'POST', path: new RegExp(`^${root}/${path}$`),
      handle: async ({ user, data, key }) => ({ body: (await eats.command(user, action, null, data, key)) }) })),
    ...[['save', 'store-save'], ['open', 'store-open'], ['review', 'store-review']].map(([path, action]) => ({ method: 'POST', path: new RegExp(`^${root}/stores/${uuid}/${path}$`),
      handle: async ({ user, match, data, key }) => ({ body: (await eats.command(user, action, match[1], data, key)) }) })),
    { method: 'POST', path: new RegExp(`^${root}/stores/${uuid}/photo$`), maxBodyBytes: 2_800_000,
      handle: async ({ user, match, data, key, reauthenticate }) => ({ body: await eats.photoCommand(user, match[1], data, key, reauthenticate) }) },
    { method: 'POST', path: new RegExp(`^${root}/orders/${uuid}/(accept|reject|prepare|ready|claim|pickup|arrive|deliver|complete_pickup|cancel)$`),
      handle: async ({ user, match, data, key }) => ({ body: (await eats.command(user, match[2], match[1], data, key)) }) },
  ];
}
