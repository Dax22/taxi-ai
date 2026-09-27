import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../public/dashboard.html', import.meta.url), 'utf8');
const mobile = await readFile(new URL('../../mobile/app/book-ride.tsx', import.meta.url), 'utf8');

test('customer ride flow is vehicle then passenger then nationwide typed destination', () => {
  const vehicle = html.indexOf('id="vehicle-categories-panel"');
  const passenger = html.indexOf('id="passenger-panel"');
  const destination = html.indexOf('id="location-destination-form"');
  const pickupPlanner = html.indexOf('id="location-planner"');
  assert.ok(vehicle >= 0 && vehicle < passenger);
  assert.ok(passenger < destination);
  assert.ok(destination < pickupPlanner);
  assert.match(html, /Where are you going\?/);
  assert.match(html, /Type an address, landmark, town or city anywhere in Nigeria/);
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

test('mobile ride flow places destination after passenger and before pickup confirmation', () => {
  const passenger = mobile.indexOf('<PassengerForm');
  const destination = mobile.indexOf('<Pill>YOUR DESTINATION</Pill>');
  const destinationSearch = mobile.indexOf('<PlaceSearch endpoint="destination"');
  const pickup = mobile.indexOf('<PlaceSearch endpoint="pickup"');
  assert.ok(passenger >= 0 && passenger < destination);
  assert.ok(destination < destinationSearch);
  assert.ok(destinationSearch < pickup);
  assert.match(mobile, /Type an address, landmark, town or city anywhere in Nigeria/);
  assert.match(mobile, /Find rides/);
  assert.match(mobile, /chooseRideDestination/);
  assert.match(mobile, /onChooseCategory/);
  assert.match(mobile, /EXPO_PUBLIC_SHOW_SAMPLE_BOOKING/);
  assert.match(mobile, /Developer sample/);
});
