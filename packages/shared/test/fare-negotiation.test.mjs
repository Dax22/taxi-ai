import test from 'node:test';
import assert from 'node:assert/strict';
import { FareNegotiation, FareError } from '../src/fare-negotiation.mjs';

const startedAt = 1_800_000_000_000;
const create = (options = {}) => new FareNegotiation({
  id: 'request-1-driver-1', customerId: 'customer-1', driverId: 'driver-1',
  suggestedFareKobo: 450_000, now: startedAt, ...options,
});
const offer = (negotiation, overrides = {}) => negotiation.propose({
  actorId: 'driver-1', amountKobo: 500_000, expectedVersion: 0,
  now: startedAt + 10, ...overrides,
});
const accept = (negotiation, state, overrides = {}) => negotiation.accept({
  actorId: 'customer-1', expectedVersion: state.version,
  offerId: state.currentOffer.id, now: startedAt + 30, ...overrides,
});
const throwsCode = (fn, code) => assert.throws(fn,
  (error) => error instanceof FareError && error.code === code);

test('a suggestion alone cannot become an agreed fare', () => {
  const negotiation = create();
  assert.equal(negotiation.snapshot().agreement, null);
  throwsCode(() => negotiation.accept({
    actorId: 'customer-1', offerId: 'invented', expectedVersion: 0,
    now: startedAt + 10,
  }), 'NO_OFFER');
  assert.equal(negotiation.snapshot().version, 0);
});

for (const channel of ['in_app', 'chat', 'voice_call']) {
  test(`${channel} offers need explicit acceptance by the other participant`, () => {
    const negotiation = create();
    const state = offer(negotiation, { channel });
    assert.equal(state.status, 'open');
    assert.equal(state.agreement, null);
    const result = accept(negotiation, state);
    assert.equal(result.status, 'agreed');
    assert.equal(result.agreement.amountKobo, 500_000);
    assert.equal(result.agreement.currency, 'NGN');
    assert.deepEqual(result.agreement.confirmedBy, ['driver-1', 'customer-1']);
    assert.equal(result.agreement.originChannel, channel);
  });
}

test('a customer may start negotiation and the driver may accept', () => {
  const negotiation = create();
  const state = offer(negotiation, { actorId: 'customer-1', amountKobo: 425_000 });
  const result = accept(negotiation, state, { actorId: 'driver-1' });
  assert.equal(result.agreement.amountKobo, 425_000);
  assert.deepEqual(result.agreement.confirmedBy, ['customer-1', 'driver-1']);
});

test('the sender cannot accept their own offer', () => {
  const negotiation = create();
  const state = offer(negotiation);
  throwsCode(() => accept(negotiation, state, { actorId: 'driver-1' }),
    'SELF_ACCEPTANCE');
  assert.deepEqual(negotiation.snapshot(), state);
});

test('a counteroffer supersedes the old offer even if its amount is identical', () => {
  const negotiation = create();
  const first = offer(negotiation);
  const counter = offer(negotiation, {
    actorId: 'customer-1', expectedVersion: first.version, now: startedAt + 20,
  });
  assert.notEqual(first.currentOffer.id, counter.currentOffer.id);
  throwsCode(() => accept(negotiation, counter, {
    actorId: 'driver-1', offerId: first.currentOffer.id,
  }), 'STALE_OFFER');
  const result = accept(negotiation, counter, { actorId: 'driver-1' });
  assert.equal(result.agreement.offerId, counter.currentOffer.id);
  assert.equal(result.offers.length, 2);
});

test('an older screen cannot accept or overwrite a newer counteroffer', () => {
  const negotiation = create();
  const first = offer(negotiation);
  const counter = offer(negotiation, {
    actorId: 'customer-1', amountKobo: 470_000,
    expectedVersion: first.version, now: startedAt + 20,
  });
  throwsCode(() => accept(negotiation, first), 'STALE_VERSION');
  throwsCode(() => offer(negotiation, {
    expectedVersion: first.version, now: startedAt + 30,
  }), 'STALE_VERSION');
  assert.deepEqual(negotiation.snapshot(), counter);
});

test('missing or nonnumeric versions are rejected', () => {
  const negotiation = create();
  for (const expectedVersion of [undefined, null, '0', -1, 0.5]) {
    throwsCode(() => offer(negotiation, { expectedVersion }), 'STALE_VERSION');
  }
  assert.equal(negotiation.snapshot().version, 0);
});

test('an offer expires at its exact deadline and can be replaced', () => {
  const negotiation = create();
  const state = offer(negotiation, { validForMs: 100 });
  throwsCode(() => accept(negotiation, state, { now: state.currentOffer.expiresAt }),
    'OFFER_EXPIRED');
  const renewed = offer(negotiation, {
    expectedVersion: state.version, now: state.currentOffer.expiresAt,
  });
  const result = accept(negotiation, renewed, { now: renewed.currentOffer.createdAt + 1 });
  assert.equal(result.status, 'agreed');
});

test('an offer is acceptable immediately before its deadline', () => {
  const negotiation = create();
  const state = offer(negotiation, { validForMs: 100 });
  assert.equal(accept(negotiation, state, {
    now: state.currentOffer.expiresAt - 1,
  }).status, 'agreed');
});

test('unassigned participants cannot propose, accept or cancel', () => {
  const negotiation = create();
  const state = offer(negotiation);
  throwsCode(() => offer(negotiation, {
    actorId: 'outsider', expectedVersion: state.version,
  }), 'FORBIDDEN');
  throwsCode(() => accept(negotiation, state, { actorId: 'outsider' }), 'FORBIDDEN');
  throwsCode(() => negotiation.cancel({
    actorId: 'outsider', expectedVersion: state.version, now: startedAt + 30,
  }), 'FORBIDDEN');
  assert.deepEqual(negotiation.snapshot(), state);
});

test('fare inputs reject fractions, unsafe integers, zero and coercible strings', () => {
  const negotiation = create();
  for (const amountKobo of [0, -1, 4500.5, '450000', NaN, Infinity,
    Number.MAX_SAFE_INTEGER + 1, null]) {
    throwsCode(() => offer(negotiation, { amountKobo }), 'INVALID_AMOUNT');
  }
  assert.equal(negotiation.snapshot().offers.length, 0);
});

test('invalid channel, expiry and timestamps leave state unchanged', () => {
  const negotiation = create();
  const original = negotiation.snapshot();
  throwsCode(() => offer(negotiation, { channel: 'sms' }), 'INVALID_CHANNEL');
  for (const validForMs of [0, -1, 0.5, Infinity, Number.MAX_SAFE_INTEGER]) {
    throwsCode(() => offer(negotiation, { validForMs }), 'INVALID_EXPIRY');
  }
  for (const now of [NaN, -1, startedAt - 1, '1800000000000']) {
    throwsCode(() => offer(negotiation, { now }), 'INVALID_TIME');
  }
  assert.deepEqual(negotiation.snapshot(), original);
});

test('an agreed fare cannot be amended, accepted twice or cancelled as an open offer', () => {
  const negotiation = create();
  const state = offer(negotiation);
  const agreed = accept(negotiation, state);
  throwsCode(() => offer(negotiation, {
    amountKobo: 900_000, expectedVersion: agreed.version, now: startedAt + 40,
  }), 'NEGOTIATION_CLOSED');
  throwsCode(() => accept(negotiation, agreed), 'NEGOTIATION_CLOSED');
  throwsCode(() => negotiation.cancel({
    actorId: 'customer-1', expectedVersion: agreed.version, now: startedAt + 40,
  }), 'NEGOTIATION_CLOSED');
  assert.deepEqual(negotiation.snapshot(), agreed);
});

for (const actorId of ['customer-1', 'driver-1']) {
  test(`${actorId} may cancel an open negotiation and prevent later acceptance`, () => {
    const negotiation = create();
    const state = offer(negotiation);
    const cancelled = negotiation.cancel({
      actorId, expectedVersion: state.version, now: startedAt + 20,
    });
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.agreement, null);
    throwsCode(() => accept(negotiation, cancelled), 'NEGOTIATION_CLOSED');
  });
}

test('snapshots cannot be used to tamper with current or agreed amounts', () => {
  const negotiation = create();
  const state = offer(negotiation);
  state.currentOffer.amountKobo = 1;
  state.offers[0].proposedBy = 'outsider';
  state.status = 'agreed';
  const actual = negotiation.snapshot();
  assert.equal(actual.currentOffer.amountKobo, 500_000);
  assert.equal(actual.currentOffer.proposedBy, 'driver-1');
  assert.equal(actual.status, 'open');
  const agreed = accept(negotiation, actual);
  agreed.agreement.amountKobo = 1;
  assert.equal(negotiation.snapshot().agreement.amountKobo, 500_000);
});

test('participants, IDs and suggestion are validated at creation', () => {
  throwsCode(() => create({ customerId: 'driver-1' }), 'INVALID_PARTICIPANTS');
  throwsCode(() => create({ id: ' ' }), 'INVALID_ID');
  throwsCode(() => create({ driverId: null }), 'INVALID_ID');
  throwsCode(() => create({ suggestedFareKobo: 0 }), 'INVALID_AMOUNT');
  assert.equal(create({ suggestedFareKobo: null }).snapshot().suggestedFareKobo, null);
});
