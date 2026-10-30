import test from 'node:test';
import assert from 'node:assert/strict';
import { arrivalGap, arrivalCancellation } from '../src/ride-integrity.mjs';

const now = 1_000_000;
test('GPS gap requires recorded arrival and a previously active location stream', () => {
  const row = { status:'arrived', arrivedAt:now-130_000, lastLocationAt:now-125_000 };
  assert.deepEqual(arrivalGap(row,now),{kind:'tracking_gap_after_arrival',arrivedAt:row.arrivedAt,lastLocationAt:row.lastLocationAt});
  for(const changed of [
    {status:'on_way'},{arrivedAt:now-100_000},{lastLocationAt:now-20_000},
    {lastLocationAt:now-200_000},{lastLocationAt:null},{arrivedAt:now+1},
  ]) assert.equal(arrivalGap({...row,...changed},now),null,JSON.stringify(changed));
});

test('cancellation signal does not implicate rides without arrival or after a verified start', () => {
  const row={status:'cancelled',arrivedAt:now-20_000,startedAt:null,cancelledAt:now,
    cancellationActorId:'customer',cancellationReason:'pickup_problem'};
  assert.deepEqual(arrivalCancellation(row),{kind:'cancelled_after_arrival',arrivedAt:row.arrivedAt,lastLocationAt:null,
    cancellationActorId:'customer',cancellationReason:'pickup_problem'});
  for(const changed of [
    {status:'completed'},{arrivedAt:null},{startedAt:now-1000},{cancelledAt:now-30_000},
  ]) assert.equal(arrivalCancellation({...row,...changed}),null);
});
