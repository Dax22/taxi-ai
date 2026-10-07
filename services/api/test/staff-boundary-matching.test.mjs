import test from 'node:test';
import assert from 'node:assert/strict';
import { staffPermission } from '../src/http/staff-boundary.mjs';

test('Matching Intelligence uses operations.read rather than legacy admin access', () => {
  assert.equal(staffPermission('/api/admin/console/matching', { role: 'admin' }), 'operations.read');
  assert.equal(staffPermission('/api/admin/console/operations', { role: 'admin' }), 'operations.read');
});

test('Production Acceptance Center separates read and manage permissions', () => {
  assert.equal(staffPermission('/api/admin/console/acceptance', { role: 'admin' }), 'acceptance.read');
  assert.equal(staffPermission('/api/admin/console/acceptance/rides.two_phone_e2e/result', { role: 'admin' }), 'acceptance.manage');
});


test('Mobile Operations separates read and device-management permissions', () => {
  assert.equal(staffPermission('/api/admin/console/mobile', { role: 'admin' }), 'mobile.read');
  assert.equal(staffPermission('/api/admin/console/mobile/devices/11111111-1111-4111-8111-111111111111/revoke', { role: 'admin' }), 'mobile.manage');
});


test('Investigation evidence routes require the dedicated case read and export permissions',()=>{
 assert.equal(staffPermission('/api/admin/console/investigations',{role:'admin'}),'investigations.read');
 assert.equal(staffPermission('/api/admin/console/investigations/export',{role:'admin'}),'investigations.export');
});
