import { categoryFare } from '/shared/transport-categories.mjs';
import { FareNegotiation } from '/shared/fare-negotiation.mjs';
import { createDemoQuote, nairaToKobo, formatNaira } from '/shared/demo-booking.mjs';
import { createVehicleCategoryPicker } from './dashboard/vehicle-categories.mjs';

const $ = (id) => document.getElementById(id);
const roles = { customer: 'Customer', driver: 'Driver' };
const actorIds = { customer: 'demo-customer', driver: 'demo-driver' };
const dialog = $('booking-dialog');
let negotiation = null;
let role = 'customer';
let timer = null;
const currentPickupId = 'wuse-ii';
const previewDestinationId = 'maitama';
const categories = createVehicleCategoryPicker($('home-vehicle-categories'), { onSelect(category) {
  $('trip-form').hidden = !category.ridePreview;
  $('standard-fare-note').textContent = `${category.name} preview · Sample pickup · Illustrative fare`;
  $('category-booking-link').href = `/app?category=${category.id}`;
  $('category-booking-link').textContent = `Book ${category.name} in your account ↗`;
  $('trip-error').textContent = '';
} });

function selectService(service, focus = false) {
  for (const name of ['ride', 'eats', 'courier']) {
    const selected = name === service;
    $(`tab-${name}`).setAttribute('aria-selected', String(selected));
    $(`tab-${name}`).tabIndex = selected ? 0 : -1;
    $(`panel-${name}`).hidden = !selected;
  }
  if (focus) $(`tab-${service}`).focus();
}

document.querySelectorAll('[data-tab]').forEach((button) => {
  button.addEventListener('click', () => selectService(button.dataset.tab));
  button.addEventListener('keydown', (event) => {
    const names = ['ride', 'eats', 'courier'];
    const current = names.indexOf(button.dataset.tab);
    let next;
    if (event.key === 'ArrowRight') next = (current + 1) % names.length;
    if (event.key === 'ArrowLeft') next = (current + names.length - 1) % names.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = names.length - 1;
    if (next !== undefined) { event.preventDefault(); selectService(names[next], true); }
  });
});
document.querySelectorAll('[data-service]').forEach((link) => {
  link.addEventListener('click', () => selectService(link.dataset.service));
});
document.querySelectorAll('[data-switch]').forEach((button) => {
  button.addEventListener('click', () => selectService(button.dataset.switch, true));
});

$('destination').addEventListener('input', () => { $('trip-error').textContent = ''; });
$('pickup').value = currentPickupId;

$('trip-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!categories.selected().ridePreview) return;
  try {
    const destination = $('destination').value.trim().replace(/\s+/g, ' ');
    if (destination.length < 3) throw new Error('Enter where you are going.');
    const quote = createDemoQuote($('pickup').value, previewDestinationId);
    $('destination').value = destination;
    quote.suggestedFareKobo = categoryFare(quote.suggestedFareKobo, categories.selected().id);
    negotiation = new FareNegotiation({
      id: crypto.randomUUID(), customerId: actorIds.customer, driverId: actorIds.driver,
      suggestedFareKobo: quote.suggestedFareKobo,
    });
    role = 'customer';
    $('summary-pickup').textContent = 'Wuse II · sample pickup';
    $('summary-destination').textContent = destination;
    $('suggested-fare').textContent = formatNaira(quote.suggestedFareKobo);
    $('fare-amount').value = String(quote.suggestedFareKobo / 100);
    $('trip-error').textContent = '';
    $('negotiation-error').textContent = '';
    renderNegotiation();
    dialog.showModal();
    dialog.scrollTop = 0;
    $('dialog-title').focus({ preventScroll: true });
    clearInterval(timer);
    timer = setInterval(updateExpiry, 1000);
  } catch (error) { $('trip-error').textContent = error.message; }
});

function updateExpiry() {
  if (!negotiation) return;
  const state = negotiation.snapshot();
  const offer = state.currentOffer;
  const open = state.status === 'open';
  const expired = offer && Date.now() >= offer.expiresAt;
  $('accept-offer').disabled = !open || !offer || expired || offer.proposedBy === actorIds[role];
  $('offer-expiry').textContent = open && offer
    ? expired ? 'Offer expired. Send a new offer to continue.'
      : `Offer expires in ${Math.max(1, Math.ceil((offer.expiresAt - Date.now()) / 1000))} seconds.`
    : '';
}

function renderNegotiation() {
  const state = negotiation.snapshot();
  const offer = state.currentOffer;
  const open = state.status === 'open';
  $('active-negotiation').hidden = !open;
  $('negotiation-result').hidden = open;
  document.querySelectorAll('[data-role]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.role === role));
  });
  $('offer-owner').textContent = offer
    ? `${offer.proposedBy === actorIds.customer ? 'CUSTOMER' : 'DRIVER'}’S CURRENT OFFER`
    : 'YOUR FARE, YOUR SAY';
  $('offer-amount').textContent = offer ? formatNaira(offer.amountKobo) : 'Make the first offer.';
  $('offer-guidance').textContent = !offer ? `${roles[role]}, you can start with the suggestion or choose your price.`
    : offer.proposedBy === actorIds[role]
      ? `Switch to ${role === 'customer' ? 'Driver' : 'Customer'} to respond, or revise your offer.`
      : 'Accept this exact price or send a counteroffer below.';
  $('accept-offer').textContent = offer ? `Accept ${formatNaira(offer.amountKobo)}` : 'Accept current offer';
  updateExpiry();

  const history = $('offer-history');
  history.replaceChildren();
  if (!state.offers.length) {
    const item = document.createElement('li'); item.textContent = 'No offers yet.'; history.append(item);
  }
  for (const [index, entry] of state.offers.entries()) {
    const item = document.createElement('li');
    const label = document.createElement('span');
    const amount = document.createElement('strong');
    label.textContent = `${index + 1}. ${entry.proposedBy === actorIds.customer ? 'Customer' : 'Driver'} offered`;
    amount.textContent = formatNaira(entry.amountKobo);
    item.append(label, amount); history.append(item);
  }
  if (!open) {
    clearInterval(timer);
    const agreed = state.status === 'agreed';
    $('result-symbol').textContent = agreed ? '✓' : '—';
    $('result-title').textContent = agreed ? 'A fare you both agreed on.' : 'Negotiation cancelled.';
    $('result-amount').textContent = agreed ? formatNaira(state.agreement.amountKobo) : '';
    $('result-detail').textContent = agreed
      ? 'The offer and acceptance record the customer’s and driver’s consent to this exact fare.'
      : 'No fare was agreed. You can start again with a new sample journey.';
    $('negotiation-result').focus();
  }
}

document.querySelectorAll('[data-role]').forEach((button) => {
  button.addEventListener('click', () => {
    role = button.dataset.role;
    $('negotiation-error').textContent = '';
    renderNegotiation();
  });
});

$('offer-form').addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    negotiation.propose({
      actorId: actorIds[role], expectedVersion: negotiation.snapshot().version,
      amountKobo: nairaToKobo($('fare-amount').value),
    });
    $('negotiation-error').textContent = '';
    renderNegotiation();
  } catch (error) { $('negotiation-error').textContent = error.message; }
});

$('accept-offer').addEventListener('click', () => {
  try {
    const state = negotiation.snapshot();
    negotiation.accept({
      actorId: actorIds[role], expectedVersion: state.version,
      offerId: state.currentOffer?.id,
    });
    $('negotiation-error').textContent = '';
    renderNegotiation();
  } catch (error) {
    $('negotiation-error').textContent = error.message;
    updateExpiry();
  }
});

$('cancel-negotiation').addEventListener('click', () => {
  try {
    negotiation.cancel({ actorId: actorIds[role], expectedVersion: negotiation.snapshot().version });
    renderNegotiation();
  } catch (error) { $('negotiation-error').textContent = error.message; }
});
$('close-dialog').addEventListener('click', () => dialog.close());
$('new-demo').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => {
  clearInterval(timer);
  negotiation = null;
});
