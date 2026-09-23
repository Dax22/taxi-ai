import { cartQuantity } from './eats.mjs';
import { readEatsResponse } from './eats-contracts.mjs';
import { mealGroups, mealQuantity } from './eats-meals.mjs';
import { resolveFoodArea } from './nigeria-areas.mjs';
const empty = () => ({ user: null, screen: 'browse', restaurants: [], catalogAreaId: '', areas: [], restaurant: null, restaurantId: null, menu: [], cart: [],
  address: { line: '', areaId: '' }, instructions: '', fulfillment: 'delivery', quote: null, order: null, orderId: null,
  deliveryConfirmed: false, foodQuery: '', foods: [], foodCount: 0, foodNextOffset: null, foodLoading: false, mealBasket: [], mealCheckout: null,
  orders: [], nextBefore: null, store: null, storeMenu: [], storeOrders: [], storeNextBefore: null, work: null, reviewStores: [], review: null,
  loading: false, busy: false, uncertain: false, stale: true, error: '', notice: '', replaceRestaurantId: null, now: 0 });
/** Shared screen state. Requests and credentials stay in each platform's transport. */
export function createEatsController({ api, makeKey, now = Date.now }) {
  let state = empty(), generation = 0, pending = null, polling = null;
  const listeners = new Set(), photos = new Map(); let identity = 0;
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
    if (state.user?.id !== user?.id || state.user?.role !== user?.role) { generation++; identity++; photos.clear(); state = empty(); pending = polling = null; }
    state.user = user; emit();
  }
  async function refreshFoods(loaded, epoch) {
    const query = '/foods?areaId=' + encodeURIComponent(state.address.areaId) + '&q=' + encodeURIComponent(state.foodQuery);
    const first = await read(query); let foods = first.foods, nextOffset = first.nextOffset;
    while (fresh(epoch) && nextOffset !== null && foods.length < loaded) {
      const offset = nextOffset, page = await read(query + '&offset=' + offset);
      if (page.nextOffset !== null && page.nextOffset <= offset) throw new Error('Food listings changed. Search again.');
      foods = [...foods, ...page.foods]; nextOffset = page.nextOffset;
    }
    return { ...first, foods, nextOffset };
  }
  async function refresh({ quiet = false, before = null } = {}) {
    if (!state.user || locked() || polling || state.foodLoading) return polling;
    const epoch = generation, screen = state.screen; if (!quiet) state.loading = true; emit();
    const task = (async () => {
      try {
        let result;
        if (screen === 'browse') {
          const selected = state.restaurantId ? read('/restaurants/' + state.restaurantId).catch((error) => { if (error.status === 404) return { store: null, menu: [] }; throw error; }) : null;
          const catalogFilters = [state.deliveryConfirmed && state.fulfillment === 'delivery' ? 'deliveryAreaId=' + encodeURIComponent(state.address.areaId) : '', state.catalogAreaId ? 'areaId=' + encodeURIComponent(state.catalogAreaId) : '', 'fulfillment=' + state.fulfillment].filter(Boolean);
          const catalogPath = '/restaurants' + (catalogFilters.length ? '?' + catalogFilters.join('&') : '');
          const [catalog, restaurant, food] = await Promise.all([read(catalogPath), selected, state.deliveryConfirmed && state.fulfillment === 'delivery' ? refreshFoods(quiet ? state.foods.length : 0, epoch) : null]);
          const basket = state.mealBasket.map((line) => ({ ...line, store: catalog.restaurants.find((store) => store.id === line.store.id) ?? line.store }));
          result = { restaurants: catalog.restaurants, areas: catalog.areas, mealBasket: basket, ...(restaurant ? { restaurant: restaurant.store, menu: restaurant.menu } : {}) };
          if (restaurant && !restaurant.store) Object.assign(result, { restaurantId: null, quote: null });
          if (food) Object.assign(result, { foods: food.foods, foodCount: food.foodCount, foodNextOffset: food.nextOffset });
          if (state.mealCheckout && basket.some((line, index) => line.store.version !== state.mealBasket[index].store.version)) result.mealCheckout = null;
          if (restaurant && state.quote && state.restaurant?.version !== restaurant.store?.version) result.quote = null;
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
    generation++; polling = null; state.screen = screen; state.loading = state.foodLoading = false; state.stale = true; state.error = state.notice = '';
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
    const epoch = ++generation; polling = null; pending = command; state.busy = true; state.loading = state.foodLoading = false; state.error = state.notice = ''; emit();
    let success = false;
    try {
      const result = readEatsResponse(await api.command('/eats' + command.path, command.data, command.key));
      if (!fresh(epoch)) return false;
      pending = null; state.uncertain = false; success = true;
      if (result.quote) state.quote = result.quote;
      if (result.checkout) state.mealCheckout = result.checkout;
      if (result.checkoutId && result.orders) {
        state.mealBasket = []; state.mealCheckout = null; state.orders = result.orders; state.nextBefore = null; state.screen = 'orders';
        state.notice = `${result.orders.length} kitchen order${result.orders.length === 1 ? '' : 's'} placed. Each kitchen prepares and delivers separately. No money was charged.`;
      }
      if (Object.hasOwn(result, 'store')) { state.store = result.store; state.storeMenu = result.menu; state.notice = 'Store changes saved.'; }
      if (result.order) {
        state.order = result.order; state.orderId = result.order.id;
        if (command.goToOrder) state.screen = 'order';
        if (command.path === '/orders') { state.cart = []; state.quote = null; state.notice = 'Your test order was sent to the kitchen. No money was charged.'; }
        else state.notice = 'Order updated.';
      }
      if (command.path.endsWith('/review')) state.review = result;
    } catch (error) {
      if (!fresh(epoch)) return false;
      state.error = error.message; state.uncertain = !error.status || error.status >= 500;
      if (!state.uncertain) { pending = null; if (['QUOTE_EXPIRED','QUOTE_USED','MENU_CHANGED','STORE_UNAVAILABLE','STALE_VERSION'].includes(error.code)) state.quote = state.mealCheckout = null; }
    } finally {
      if (fresh(epoch)) {
        state.busy = false; emit();
        if (!state.uncertain && !['/quotes', '/checkouts'].includes(command.path)) {
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
  async function findMeals(query = state.foodQuery, more = false) {
    if (locked() || !state.user || !state.deliveryConfirmed || state.screen !== 'browse') return false;
    const offset = more ? state.foodNextOffset : 0; if (offset === null) return false;
    const epoch = ++generation; polling = null; state.foodQuery = query.trim().slice(0, 200); state.foodLoading = true; state.loading = false; state.error = ''; emit();
    try {
      const response = await read('/foods?areaId=' + encodeURIComponent(state.address.areaId) + '&q=' + encodeURIComponent(state.foodQuery) + '&offset=' + offset);
      if (!fresh(epoch)) return false;
      state.foods = more ? [...new Map([...state.foods, ...response.foods].map((food) => [food.item.id, food])).values()] : response.foods;
      state.foodCount = response.foodCount; state.foodNextOffset = response.nextOffset;
      return true;
    } catch (error) { if (fresh(epoch)) { state.error = error.message; state.foods = []; state.foodCount = 0; state.foodNextOffset = null; } return false; }
    finally { if (fresh(epoch)) { state.foodLoading = false; emit(); } }
  }
  return Object.freeze({ context, navigate, refresh, selectRestaurant,
    findMeals,
    browseLocation(areaId) {
      if (locked()) return Promise.resolve(false);
      if (areaId !== '' && !resolveFoodArea(areaId)) { state.error = 'Choose a Nigerian state and enter the kitchen town or area.'; emit(); return Promise.resolve(false); }
      state.catalogAreaId = areaId; state.restaurants = []; return navigate('browse');
    },
    confirmDelivery(address) {
      if (locked()) return Promise.resolve(false);
      if (typeof address.line !== 'string' || address.line.trim().length < 8 || address.line.trim().length > 240 || !resolveFoodArea(address.areaId)) {
        state.error = 'Enter a delivery address and landmark, then choose the state and town or area.'; emit(); return Promise.resolve(false);
      }
      if (state.address.areaId !== address.areaId) { state.mealBasket = []; state.cart = []; state.restaurant = null; state.restaurantId = null; state.menu = []; state.catalogAreaId = ''; state.restaurants = []; state.foods = []; state.foodCount = 0; state.foodNextOffset = null; }
      state.address = { line: address.line.trim(), areaId: address.areaId }; state.deliveryConfirmed = true; state.fulfillment = 'delivery'; state.mealCheckout = state.quote = null; state.error = ''; emit();
      return navigate('browse');
    },
    editDelivery() { if (locked()) return; generation++; polling = null; state.deliveryConfirmed = false; state.foods = []; state.foodLoading = state.loading = false; state.mealCheckout = state.quote = null; emit(); },
    mealQuantity(food, quantity) { if (locked()) return; try { state.mealBasket = mealQuantity(state.mealBasket, food, quantity); state.mealCheckout = null; state.error = ''; } catch (error) { state.error = error.message; } emit(); },
    async reviewMeal() {
      if (locked() || state.foodLoading || !state.deliveryConfirmed || !state.mealBasket.length) return false;
      const owner = identity, epoch = generation; await refresh({ quiet: true });
      if (owner !== identity || epoch !== generation || state.screen !== 'browse' || !state.deliveryConfirmed) return false;
      return run('/checkouts', { groups: mealGroups(state.mealBasket), address: state.address, instructions: state.instructions });
    },
    placeMeal() { return state.mealCheckout && now() < state.mealCheckout.expiresAt ? run('/checkouts/place', { checkoutId: state.mealCheckout.id }) : Promise.resolve(false); },
    async photo(id) {
      if (!state.user || !id) return null;
      const owner = identity;
      if (!photos.has(id)) {
        if (photos.size >= 64) photos.delete(photos.keys().next().value);
        const request = read('/photos/' + id).then((body) => 'data:image/jpeg;base64,' + body.photo.base64).catch(() => { photos.delete(id); return null; });
        photos.set(id, request);
      }
      const uri = await photos.get(id); return owner === identity && state.user ? uri : null;
    },
    fulfillment(value) {
      if (locked() || !['delivery', 'pickup'].includes(value) || value === state.fulfillment) return;
      generation++; polling = null; state.loading = state.foodLoading = false; state.fulfillment = value; state.quote = null; state.restaurants = []; emit();
      if (state.screen === 'browse') void refresh({ quiet: true });
    },
    snapshot: () => state, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    reset() { context(null); },
    tick() { if (state.quote && now() >= state.quote.expiresAt || state.mealCheckout && now() >= state.mealCheckout.expiresAt) { state.quote = state.mealCheckout = null; state.notice = 'Checkout expired. Review the total again before ordering.'; } emit(); },
    retry: () => pending ? execute(pending) : Promise.resolve(false),
    keepRestaurant() { state.replaceRestaurantId = null; emit(); },
    quantity(itemId, quantity) { if (locked()) return; try { state.cart = cartQuantity(state.cart, itemId, quantity); state.quote = null; state.error = ''; } catch (error) { state.error = error.message; } emit(); },
    delivery(address, instructions) {
      if (locked()) return;
      if (state.address.areaId !== address.areaId) {
        generation++; polling = null; state.loading = state.foodLoading = false; state.deliveryConfirmed = false;
        state.foods = []; state.foodCount = 0; state.foodNextOffset = null; state.mealBasket = []; state.restaurants = []; state.catalogAreaId = '';
      }
      state.address = { ...address }; state.instructions = instructions; state.quote = state.mealCheckout = null; emit();
    },
    checkout() { if (!state.restaurant) return Promise.resolve(false); return run('/quotes', { storeId: state.restaurant.id, expectedVersion: state.restaurant.version, items: state.cart, fulfillment: state.fulfillment, address: state.address, instructions: state.instructions }); },
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
