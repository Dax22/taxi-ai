import { cartQuantity } from './eats.mjs';
import { readEatsResponse } from './eats-contracts.mjs';
const empty = () => ({ user: null, screen: 'browse', restaurants: [], areas: [], restaurant: null, restaurantId: null, menu: [], cart: [],
  address: { line: '', areaId: 'wuse-ii' }, instructions: '', quote: null, order: null, orderId: null,
  orders: [], nextBefore: null, store: null, storeMenu: [], storeOrders: [], storeNextBefore: null, work: null, reviewStores: [], review: null,
  loading: false, busy: false, uncertain: false, stale: true, error: '', notice: '', replaceRestaurantId: null, now: 0 });
/** Shared screen state. Requests and credentials stay in each platform's transport. */
export function createEatsController({ api, makeKey, now = Date.now }) {
  let state = empty(), generation = 0, pending = null, polling = null;
  const listeners = new Set();
  const emit = () => { state = { ...state, now: now() }; for (const listener of listeners) listener(); };
  const fresh = (epoch) => epoch === generation && Boolean(state.user);
  const read = async (path) => readEatsResponse(await api.request('/eats' + path));
  const locked = () => state.busy || state.uncertain;
  function page(response, previous, cursor, before, quiet) {
    const overlaps = response.orders.some((order) => previous.some((old) => old.id === order.id));
    // Keep already loaded pages during polling, unless a gap requires restarting pagination.
    const keep = before || (quiet && overlaps);
    const rows = keep ? [...response.orders, ...previous] : response.orders;
    const orders = [...new Map(rows.map((row) => [row.id, row])).values()];
    for (const row of response.orders) { const index = orders.findIndex((old) => old.id === row.id); orders[index] = row; }
    const closed = (o) => ['delivered', 'cancelled', 'rejected'].includes(o.status) ? 1 : 0;
    orders.sort((a, b) => (state.screen === 'store' ? closed(a) - closed(b) : 0) || b.createdAt - a.createdAt || b.id.localeCompare(a.id));
    return { orders, nextBefore: !before && keep ? cursor : response.nextBefore };
  }
  function context(user) {
    if (state.user?.id !== user?.id || state.user?.role !== user?.role) { generation++; state = empty(); pending = polling = null; }
    state.user = user; emit();
  }
  async function refresh({ quiet = false, before = null } = {}) {
    if (!state.user || locked() || polling) return polling;
    const epoch = generation, screen = state.screen; if (!quiet) state.loading = true; emit();
    const task = (async () => {
      try {
        let result;
        if (screen === 'browse') {
          const [catalog, restaurant] = await Promise.all([read('/restaurants'), state.restaurantId ? read('/restaurants/' + state.restaurantId) : null]);
          result = { restaurants: catalog.restaurants, areas: catalog.areas, ...(restaurant ? { restaurant: restaurant.store, menu: restaurant.menu } : {}) };
          if (restaurant && state.quote && state.restaurant?.version !== restaurant.store.version) result.quote = null;
        } else if (screen === 'orders') { const response = await read('/orders' + (before ? '?before=' + before : '')); result = page(response, state.orders, state.nextBefore, before, quiet); }
        else if (screen === 'store') {
          const mine = await read('/store'), response = mine.store ? await read('/orders?scope=store' + (before ? '&before=' + before : '')) : { orders: [], nextBefore: null };
          const orders = page(response, state.storeOrders, state.storeNextBefore, before, quiet);
          result = { store: mine.store, storeMenu: mine.menu, areas: mine.areas, storeOrders: orders.orders, storeNextBefore: orders.nextBefore };
        } else if (screen === 'work') result = { work: await read('/work') };
        else if (screen === 'review') result = { reviewStores: (await read('/admin/stores')).stores, ...(state.review ? { review: await read('/restaurants/' + state.review.store.id) } : {}) };
        else result = { order: (await read('/orders/' + state.orderId)).order };
        if (fresh(epoch)) { Object.assign(state, result); state.stale = false; state.error = ''; }
      } catch (error) {
        if (fresh(epoch)) { state.error = error.message; state.stale = true; if ([401,403,404].includes(error.status)) { state.order = state.store = state.work = state.review = null; state.orders = state.storeOrders = state.storeMenu = []; } }
      } finally { if (polling === task) polling = null; if (fresh(epoch)) { state.loading = false; emit(); } }
    })();
    polling = task; return task;
  }
  async function navigate(screen, id = null) {
    if (locked()) { state.error = 'Finish or retry the pending action before leaving this screen.'; emit(); return false; }
    generation++; polling = null; state.screen = screen; state.loading = false; state.stale = true; state.error = state.notice = '';
    if (screen === 'order') { state.orderId = id; state.order = null; }
    emit(); await refresh(); return !state.stale;
  }
  async function selectRestaurant(id, replace = false) {
    if (locked()) return false;
    if (state.restaurantId !== id && state.cart.length && !replace) { state.replaceRestaurantId = id; emit(); return false; }
    if (state.restaurantId !== id) { state.cart = []; state.quote = null; state.restaurant = null; state.menu = []; state.restaurantId = id; }
    state.replaceRestaurantId = null; return navigate('browse');
  }
  async function execute(command) {
    if (state.busy || !state.user) return false;
    const epoch = ++generation; polling = null; pending = command; state.busy = true; state.loading = false; state.error = state.notice = ''; emit();
    let success = false;
    try {
      const result = readEatsResponse(await api.command('/eats' + command.path, command.data, command.key));
      if (!fresh(epoch)) return false;
      pending = null; state.uncertain = false; success = true;
      if (result.quote) state.quote = result.quote;
      if (Object.hasOwn(result, 'store')) { state.store = result.store; state.storeMenu = result.menu; state.notice = 'Store changes saved.'; }
      if (result.order) {
        state.order = result.order; state.orderId = result.order.id;
        if (command.goToOrder) state.screen = 'order';
        if (command.path === '/orders') { state.cart = []; state.quote = null; state.notice = 'Your test order was sent to the restaurant. No money was charged.'; }
        else state.notice = 'Order updated.';
      }
      if (command.path.endsWith('/review')) state.review = result;
    } catch (error) {
      if (!fresh(epoch)) return false;
      state.error = error.message; state.uncertain = !error.status || error.status >= 500;
      if (!state.uncertain) { pending = null; if (['QUOTE_EXPIRED','MENU_CHANGED','STORE_UNAVAILABLE','STALE_VERSION'].includes(error.code)) state.quote = null; }
    } finally {
      if (fresh(epoch)) {
        state.busy = false; emit();
        if (!state.uncertain && command.path !== '/quotes') {
          const error = state.error, notice = state.notice; await refresh({ quiet: true });
          if (fresh(epoch)) { if (error) state.error = error; state.notice = notice; emit(); }
        }
      }
    }
    return success;
  }
  function run(path, data, goToOrder = false) {
    if (locked() || state.stale || !state.user) return Promise.resolve(false);
    return execute({ path, data: structuredClone(data), key: makeKey(), goToOrder });
  }
  return Object.freeze({ context, navigate, refresh, selectRestaurant,
    snapshot: () => state, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    reset() { context(null); },
    tick() { if (state.quote && now() >= state.quote.expiresAt) { state.quote = null; state.notice = 'Checkout expired. Review the total again before ordering.'; } emit(); },
    retry: () => pending ? execute(pending) : Promise.resolve(false),
    keepRestaurant() { state.replaceRestaurantId = null; emit(); },
    quantity(itemId, quantity) { if (locked()) return; try { state.cart = cartQuantity(state.cart, itemId, quantity); state.quote = null; state.error = ''; } catch (error) { state.error = error.message; } emit(); },
    delivery(address, instructions) { if (locked()) return; state.address = { ...address }; state.instructions = instructions; state.quote = null; emit(); },
    checkout() { if (!state.restaurant) return Promise.resolve(false); return run('/quotes', { storeId: state.restaurant.id, expectedVersion: state.restaurant.version, items: state.cart, address: state.address, instructions: state.instructions }); },
    place() { return state.quote && now() < state.quote.expiresAt ? run('/orders', { quoteId: state.quote.id }, true) : Promise.resolve(false); },
    orderAction(order, action, extras = {}) { return run(`/orders/${order.id}/${action}`, { expectedVersion: order.version, ...extras }, action === 'claim'); },
    createStore(details) { return run('/stores', { details }); },
    storeAction(action, data, store = state.store) { return store ? run(`/stores/${store.id}/${action}`, { expectedVersion: store.version, ...data }) : Promise.resolve(false); },
    async reviewStore(id) {
      if (locked()) return; const epoch = generation;
      try { const result = await read('/restaurants/' + id); if (fresh(epoch)) { state.review = result; emit(); } }
      catch (error) { if (fresh(epoch)) { state.error = error.message; emit(); } }
    },
  });
}
