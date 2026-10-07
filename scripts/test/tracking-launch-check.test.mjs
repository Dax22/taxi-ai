import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACKING_RELEASE_GATES, evaluateTrackingLaunch } from '../tracking-launch-check.mjs';
const now = Date.UTC(2026, 9, 3), releaseCommit = 'a'.repeat(40);
const reviewedFixture = () => ({ releaseCommit, checks: Object.fromEntries(TRACKING_RELEASE_GATES.map(gate => [gate,
  { status: 'passed', releaseCommit, completedAt: new Date(now).toISOString(), reviewer: 'Fixture reviewer', reference: 'fixture-only-record' }])) });
test('a blank acceptance template and community maps cannot pass the production checklist', () => {
  const result = evaluateTrackingLaunch({}, { enabled: true, mode: 'community' }, now);
  assert.equal(result.ready, false); assert.ok(result.blockers.length >= TRACKING_RELEASE_GATES.length);
});
test('only a complete current evidence inventory for the same release satisfies the checklist', () => {
  const evidence = reviewedFixture(), maps = { enabled: true, mode: 'dedicated' };
  assert.equal(evaluateTrackingLaunch(evidence, maps, now).ready, true);
  evidence.checks.locked_screen_tracking.releaseCommit = 'b'.repeat(40);
  assert.equal(evaluateTrackingLaunch(evidence, maps, now).ready, false);
});
test('old, future-dated and unreviewed evidence remain blockers', () => {
  for (const changes of [{ completedAt: new Date(now + 1).toISOString() }, { completedAt: new Date(now - 15 * 86_400_000).toISOString() }, { reviewer: '' }, { reference: '' }]) {
    const evidence = reviewedFixture(); Object.assign(evidence.checks.sender_recipient_live_map, changes);
    assert.equal(evaluateTrackingLaunch(evidence, { enabled: true, mode: 'dedicated' }, now).ready, false);
  }
});
test('passing a mocked inventory is explicitly not a real-device or provider attestation', () => {
  const result = evaluateTrackingLaunch(reviewedFixture(), { enabled: true, mode: 'dedicated' }, now);
  assert.match(result.notice, /not the truth of an attestation/);
});
