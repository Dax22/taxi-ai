import test from 'node:test';
import assert from 'node:assert/strict';
import { boundaryError, sourceErrors, findCycle, importSpecifiers } from '../architecture-rules.mjs';

test('module boundaries reject business-to-storage and cross-feature imports while allowing pure rules', () => {
  const service = 'services/api/src/modules/rides/service.mjs';
  for (const target of ['services/api/src/modules/rides/repository.mjs', 'services/api/src/modules/accounts/service.mjs',
    'services/api/src/http/router.mjs', 'services/api/src/infrastructure/database.mjs']) assert.ok(boundaryError(service, target), target);
  assert.equal(boundaryError(service, 'services/api/src/modules/rides/domain.mjs'), null);
  assert.equal(boundaryError(service, 'packages/shared/src/fare-negotiation.mjs'), null);
  assert.ok(boundaryError('apps/web/public/dashboard.mjs', service));
  assert.ok(boundaryError('apps/admin/public/pages.mjs', service));
  assert.ok(boundaryError('apps/admin/public/pages.mjs', 'apps/web/public/dashboard/views.mjs'));
  assert.ok(sourceErrors('apps/admin/public/pages.mjs', "fetch('/api/session');").length);
  assert.ok(boundaryError('packages/shared/src/fare-negotiation.mjs', service));
  assert.ok(sourceErrors(service, "db.prepare('SELECT 1');").length);
  assert.ok(sourceErrors(service, "const repository = await import('./repository.mjs');").length);
});

test('dependency cycles are reported and independent modules remain allowed', () => {
  assert.deepEqual(findCycle(new Map([['a', ['b']], ['b', ['c']], ['c', ['a']]])), ['a', 'b', 'c', 'a']);
  assert.equal(findCycle(new Map([['a', ['b']], ['b', []], ['c', ['b']]])), null);
});

test('static dependency scanning finds imports and re-exports without treating date filter keys as paths', () => {
  assert.deepEqual(importSpecifiers("import { one,\n two } from './one.mjs';\nimport './side-effect.mjs';\nexport { one } from'./other.mjs';\nconst fields = ['from', 'to'];"),
    ['./one.mjs', './side-effect.mjs', './other.mjs']);
});
