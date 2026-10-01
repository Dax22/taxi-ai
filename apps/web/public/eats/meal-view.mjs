import { foodAreaLabel } from './location-fields.mjs';
import { createDeliveryForm } from './delivery-form.mjs';
import { $, element } from '../dashboard/dom.mjs';
import { EATS_SELLERS, foodAvailable, foodStock, isPrivateKitchen } from '/shared/eats.mjs';
import { formatNaira } from '/shared/demo-booking.mjs';
const field = (id) => $('food-meal-' + id);
const suggestions = ['Jollof rice', 'Egusi & pounded yam', 'Suya', 'Plantain', 'Moi moi'];

export function createMealView(controller, { button, mealPhoto, totals, geolocation, createMap }) {
  let state, owner, keys = new Map();
  const locked = () => state.busy || state.uncertain || state.stale;
  const update = (id, value, build) => {
    const key = JSON.stringify(value); if (keys.get(id) === key) return;
    keys.set(id, key); const root = field(id); root.replaceChildren(); build(root);
  };
  const deliveryForm = createDeliveryForm(controller, { geolocation, createMap, onConfirmed: () => field('query').focus() });
  field('search-form').addEventListener('submit', (event) => { event.preventDefault(); void controller.findMeals(field('query').value); });
  field('more').addEventListener('click', () => void controller.findMeals(state.foodQuery, true));
  field('instructions').addEventListener('input', () => controller.delivery(state.address, field('instructions').value));
  field('review').addEventListener('click', () => void controller.reviewMeal());
  field('place').addEventListener('click', () => void controller.placeMeal());
  return { render(next) {
    state = next;
    if (owner !== state.user?.id) {
      owner = state.user?.id; keys.clear();
      for (const id of ['query', 'instructions']) field(id).value = '';
      for (const id of ['results', 'lines', 'quotes']) field(id).replaceChildren();
    }
    deliveryForm.render(state);
    if (!state.user) return;
    const admin = state.user.role === 'admin';
    field('builder').hidden = field('destination').hidden = !state.deliveryConfirmed;
    $('food-kitchen-browser').hidden = !state.deliveryConfirmed;
    field('query').disabled = field('find').disabled = locked() || state.foodLoading;
    field('instructions').disabled = locked();
    if (document.activeElement !== field('instructions')) field('instructions').value = state.instructions;
    field('count').textContent = state.foodLoading ? 'Finding dishes for your delivery area…' : `${state.foodCount} available dishes${state.foodQuery ? ` matching “${state.foodQuery}”` : ''} · prices set by the sellers`;
    field('more').hidden = state.foodNextOffset === null; field('more').disabled = locked() || state.foodLoading;
    update('suggestions', [locked(), state.foodLoading], (root) => {
      for (const query of suggestions) { const b = button(query, () => { field('query').value = query; void controller.findMeals(query); }, true); b.disabled ||= state.foodLoading; root.append(b); }
    });
    update('results', [state.foods, state.mealBasket, state.foodLoading, locked()], (root) => {
      if (!state.foodLoading && !state.foods.length) root.append(element('p', 'No dishes available for this search yet. Try another dish, or change your delivery area.', 'food-empty'));
      for (const food of state.foods) {
        const { store, item } = food, row = element('article', undefined, 'food-dish');
        row.append(mealPhoto(item.photoId, item.name, 'food-dish-photo', item.photoVersion));
        const info = element('div', undefined, 'food-dish-info');
        const town = foodAreaLabel(store.areaId);
        info.append(element('span', `${EATS_SELLERS[store.sellerType ?? 'restaurant']} · ${town}`, 'food-kitchen-type'), element('h3', item.name), element('p', store.name, 'food-dish-seller'), element('p', item.description, 'small-note'));
        if (item.allergens) info.append(element('p', `Allergens: ${item.allergens}`, 'small-note'));
        if (!isPrivateKitchen(store.sellerType)) info.append(element('p', store.address, 'small-note'));
        info.append(element('p', `${store.prepMinutes} min preparation · ${formatNaira(store.deliveryFeeKobo)} delivery per kitchen`, 'small-note'));
        const bottom = element('div', undefined, 'food-dish-bottom'), controls = element('div', undefined, 'food-quantity');
        const quantity = state.mealBasket.find((l) => l.item.id === item.id)?.quantity ?? 0;
        const less = button('−', () => controller.mealQuantity(food, quantity - 1), true), more = button('+', () => controller.mealQuantity(food, quantity + 1));
        less.setAttribute('aria-label', `Remove one ${item.name} from ${store.name}`); more.setAttribute('aria-label', `Add one ${item.name} from ${store.name}`);
        less.disabled ||= !quantity; more.disabled ||= admin || !foodAvailable(item) || quantity >= Math.min(20, item.portionsRemaining ?? 20);
        controls.append(less, element('span', String(quantity)), more);
        bottom.append(element('strong', formatNaira(item.priceKobo)), controls);
        info.append(element('p', foodStock(item), 'food-stock'), bottom); row.append(info); root.append(row);
      }
    });
    update('lines', [state.mealBasket, locked()], (root) => {
      if (!state.mealBasket.length) root.append(element('p', 'A little of this. A little of that. Add dishes to build your meal.', 'small-note'));
      for (const storeId of new Set(state.mealBasket.map((l) => l.store.id))) {
        const lines = state.mealBasket.filter((l) => l.store.id === storeId), group = element('div', undefined, 'food-basket-group');
        group.append(element('h3', lines[0].store.name));
        for (const line of lines) {
          const row = element('div', undefined, 'food-basket-line');
          row.append(element('p', `${line.quantity} × ${line.item.name} · ${formatNaira(line.quantity * line.item.priceKobo)}`), button('Remove', () => controller.mealQuantity(line, 0), true)); group.append(row);
        }
        group.append(element('p', `Minimum food order ${formatNaira(lines[0].store.minimumKobo)} · ${formatNaira(lines[0].store.deliveryFeeKobo)} delivery`, 'small-note')); root.append(group);
      }
      if (state.mealBasket.length) root.append(element('p', `Food subtotal · ${formatNaira(state.mealBasket.reduce((sum, l) => sum + l.quantity * l.item.priceKobo, 0))}`, 'food-subtotal'));
    });
    field('review').disabled = locked() || state.foodLoading || !state.mealBasket.length || admin;
    field('checkout').hidden = !state.mealCheckout;
    update('quotes', state.mealCheckout, (root) => {
      if (!state.mealCheckout) return;
      for (const quote of state.mealCheckout.quotes) { const group = element('section', undefined, 'food-basket-group'); group.append(element('h3', quote.restaurant.name)); for (const line of quote.lines) group.append(element('p', `${line.quantity} × ${line.name} · ${formatNaira(line.quantity * line.priceKobo)}`, 'small-note')); group.append(totals(quote.totals)); root.append(group); }
      root.append(element('h3', `Combined total · ${formatNaira(state.mealCheckout.totals.totalKobo)}`));
    });
    field('expiry').textContent = state.mealCheckout ? `Deliver to ${state.recipient?.kind === 'other' ? state.recipient.name + ' at ' : ''}${state.address.line}. Total held until ${new Date(state.mealCheckout.expiresAt).toLocaleTimeString()}.` : '';
    field('place').textContent = state.mealCheckout?.quotes.length === 1 ? 'Place test order' : `Place ${state.mealCheckout?.quotes.length ?? ''} test orders`;
    field('place').disabled = locked() || !state.mealCheckout || state.now >= state.mealCheckout.expiresAt;
  } };
}
