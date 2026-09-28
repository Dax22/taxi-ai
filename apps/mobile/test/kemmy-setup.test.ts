import test from 'node:test';
import assert from 'node:assert/strict';
import { readKemmySetup } from '../src/kemmy/contracts.ts';

const valid = {
  version: 1, assistant: 'Kemmy', deterministic: true, nextStep: 'welcome', autoOpen: true,
  startedAt: null, emailDeferredAt: null, experience: null, notificationsChoice: null,
  safetyChoice: null, dismissedAt: null, completedAt: null, emailVerified: false,
};

test('native Kemmy setup contract accepts only bounded deterministic setup state', () => {
  assert.deepEqual(readKemmySetup(structuredClone(valid)), valid);
  for (const changed of [
    { ...valid, assistant: 'Other' },
    { ...valid, deterministic: false },
    { ...valid, nextStep: 'chat' },
    { ...valid, experience: 'admin' },
    { ...valid, notificationsChoice: 'forced' },
    { ...valid, safetyChoice: 'required' },
    { ...valid, startedAt: -1 },
  ]) assert.throws(() => readKemmySetup(changed));
});
