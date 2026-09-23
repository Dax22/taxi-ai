import test from 'node:test';
import assert from 'node:assert/strict';
import { NIGERIAN_STATES, LEGACY_FOOD_AREAS, foodAreaId, resolveFoodArea } from '../src/nigeria-areas.mjs';
import { DEMO_AREAS } from '../src/demo-booking.mjs';

test('state registry contains 36 states and FCT with immutable stable IDs', () => {
  assert.equal(NIGERIAN_STATES.length, 37);
  assert.equal(new Set(NIGERIAN_STATES.map((s) => s.id)).size, 37);
  assert.equal(NIGERIAN_STATES.find((s) => s.id === 'fct').name, 'Federal Capital Territory');
  assert.equal(NIGERIAN_STATES.find((s) => s.id === 'cross-river').name, 'Cross River');
  assert.throws(() => { NIGERIAN_STATES[0].name = 'Changed'; }, TypeError);
});

test('any town or district works in each state without a finite city catalogue', () => {
  for (const state of NIGERIAN_STATES) {
    const id = foodAreaId(state.id, 'Example Town');
    const area = resolveFoodArea(id);
    assert.deepEqual(area, {id,name:'Example Town',town:'Example Town',stateId:state.id,stateName:state.name});
    assert.equal('lat' in area, false, 'entered names must never manufacture a dispatch centroid');
    assert.equal('lng' in area, false);
  }
  assert.equal(foodAreaId('lagos','Ikeja'), 'ng:lagos:ikeja');
  assert.equal(foodAreaId('rivers','Port Harcourt'), 'ng:rivers:port%20harcourt');
  assert.notEqual(foodAreaId('lagos','Ojo'), foodAreaId('oyo','Ojo'), 'same town name must be isolated by state');
});

test('normalization makes spacing case and Unicode compatibility consistent', () => {
  const id = foodAreaId('ogun', '  ÌJẸ̀BÚ\u00a0  ÒDE  ');
  assert.equal(id, foodAreaId('ogun','Ìjẹ̀bú Òde'));
  assert.equal(foodAreaId('lagos', 'Ｉｋｅｊａ'), foodAreaId('lagos','Ikeja'));
  assert.equal(foodAreaId('lagos','Ojo-Ota'), foodAreaId('lagos',' ojo-ota '));
  const area = resolveFoodArea(id);
  assert.equal(foodAreaId(area.stateId,area.town), id, 'display can round-trip');
});

test('original seven Abuja IDs and labels survive and typed FCT towns reuse them', () => {
  assert.deepEqual(LEGACY_FOOD_AREAS.map(({id,name}) => ({id,name})), DEMO_AREAS);
  for (const area of LEGACY_FOOD_AREAS) {
    assert.equal(resolveFoodArea(area.id), area);
    assert.equal(foodAreaId('fct', ` ${area.name.toUpperCase()} `), area.id);
    assert.equal(area.stateId, 'fct');
    assert.equal(resolveFoodArea(`ng:fct:${encodeURIComponent(area.name.toLowerCase())}`), null, 'no competing ID for an existing locality');
  }
  assert.notEqual(foodAreaId('lagos','Garki'), 'garki');
});

test('invalid names and unknown states cannot become trusted locality identifiers', () => {
  for (const stateId of [null, undefined, {}, 'NG-LA', 'Lagos', 'unknown', '__proto__']) {
    assert.throws(() => foodAreaId(stateId, 'Ikeja'));
  }
  for (const town of [null, undefined, {}, '', '  ', 'a', 'a'.repeat(81), '123', 'A:B',
    'Ikeja/Other', '<Ikeja>', 'Ikeja\nOther', 'Ikeja\tOther', 'Ikeja\u0000', 'Ikeja\u200d',
    'Ikeja%20', 'Ikeja?foo', 'Ikeja#route', ':Ikeja']) assert.throws(() => foodAreaId('lagos', town));
  assert.ok(foodAreaId('lagos','a'.repeat(80)));
});

test('strict decoding prevents alternate encodings and malformed IDs from bypassing matching', () => {
  for (const id of [null, 1, {}, '', 'wuse-II', 'ng:unknown:ikeja', 'ng:lagos:',
    'ng:lagos:Ikeja', 'ng:lagos:%69keja', 'ng:lagos:ikeja%20', 'ng:lagos:%',
    'ng:lagos:%C0%AF', 'ng:lagos:a%3Ab', 'ng:lagos:a%2Fb', 'ng:lagos:a:b',
    'ng:lagos:town%2520name', 'ng:lagos:town name']) assert.equal(resolveFoodArea(id), null);
  assert.equal(resolveFoodArea('ng:rivers:port%20harcourt').town,'Port Harcourt');
  assert.throws(() => { resolveFoodArea('ng:lagos:ikeja').town = 'Elsewhere'; }, TypeError);
});
