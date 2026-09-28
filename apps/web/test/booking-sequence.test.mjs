import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../public/dashboard.html', import.meta.url), 'utf8');
const mobile = await readFile(new URL('../../mobile/app/book-ride.tsx', import.meta.url), 'utf8');
const mobileJourney = await readFile(new URL('../../mobile/app/journey.tsx', import.meta.url), 'utf8');
const mobileChat = await readFile(new URL('../../mobile/src/journeys/chat.tsx', import.meta.url), 'utf8');
const mobilePreview = await readFile(new URL('../../mobile/src/booking/route-preview.tsx', import.meta.url), 'utf8');

test('customer ride flow is destination-first with current-location pickup and fare negotiation', () => {
  const vehicle = html.indexOf('id="vehicle-categories-panel"');
  const destinationPanel = html.indexOf('id="ride-destination-panel"');
  const destination = html.indexOf('id="location-destination-form"');
  const passenger = html.indexOf('id="passenger-panel"');
  const pickupPlanner = html.indexOf('id="location-planner"');
  assert.ok(vehicle >= 0 && vehicle < destinationPanel);
  assert.ok(destinationPanel < destination);
  assert.ok(destination < passenger);
  assert.ok(passenger < pickupPlanner);
  assert.match(html, /Where are you going\?/);
  assert.match(html, /Pickup:<\/strong> Your current location/);
  assert.match(html, /Pickup from your current location/);
  assert.match(html, /Taxi Ai will use your current device location as the pickup/);
  assert.match(html, /Taxi Ai uses your current device location as the pickup for passenger rides/);
  assert.match(html, /Type your destination anywhere in Nigeria/);
  assert.match(html, /placeholder="e\.g\. Lekki Phase 1, Lagos"/);
  assert.match(html, />Find rides<\/button>/);
  assert.match(html, /id="location-ride-options"/);
  assert.match(html, /id="location-price"/);
  assert.match(html, /id="fare-open-chat"/);
  assert.match(html, /id="fare-open-call"/);
  assert.match(html, /Find a driver/);
  assert.doesNotMatch(html, />Find destination<\/button>/);
  assert.doesNotMatch(html, /Request selected ride/);
  assert.doesNotMatch(html, /<datalist\b/i);
  assert.doesNotMatch(html, /list="request-destination-areas"/);
  assert.doesNotMatch(html, /id="request-destination-areas"/);
});

test('mobile ride flow puts destination before passenger and uses current GPS pickup', () => {
  const passenger = mobile.indexOf('<PassengerForm');
  const destination = mobile.indexOf('<Pill>YOUR DESTINATION</Pill>');
  const destinationSearch = mobile.indexOf('<PlaceSearch endpoint="destination"');
  const pickup = mobile.indexOf('<PlaceSearch endpoint="pickup"');
  assert.ok(destination >= 0 && destination < destinationSearch);
  assert.ok(destinationSearch < passenger);
  assert.ok(passenger < pickup);
  assert.match(mobile, /Type an address, landmark, town or city anywhere in Nigeria/);
  assert.match(mobile, /Find rides/);
  assert.match(mobile, /Pickup is your current phone location/);
  assert.match(mobile, /Pickup from your current location/);
  assert.match(mobile, /Taxi Ai uses a fresh phone location as your passenger pickup/);
  assert.match(mobile, /Refresh current pickup/);
  assert.match(mobile, /chooseRideDestination/);
  assert.match(mobile, /onChooseCategory/);
  assert.match(mobile, /EXPO_PUBLIC_SHOW_SAMPLE_BOOKING/);
  assert.match(mobile, /Developer sample/);
});


test('fare negotiation is communication first, exact acceptance second, ride confirmation last', () => {
  assert.match(html, /Talk with your driver before accepting/);
  assert.match(html, /Chat with driver/);
  assert.match(html, /Call driver in app/);
  assert.match(html, /exact current offer must still be accepted|exact offer accepted/i);
  assert.match(mobilePreview, /Find a .*driver/);
  assert.match(mobilePreview, /starting fare, not an accepted price/);
  const negotiationChat = mobileJourney.indexOf("r.status==='negotiating'&&<JourneyChat");
  const acceptFare = mobileJourney.indexOf('Accept exact fare');
  const confirmRide = mobileJourney.indexOf('Confirm ride');
  assert.ok(negotiationChat >= 0 && negotiationChat < acceptFare);
  assert.ok(acceptFare < confirmRide);
  assert.match(mobileChat, /Discuss the fare here first/);
  assert.match(mobileChat, /chat message by itself never confirms a fare/);
});
