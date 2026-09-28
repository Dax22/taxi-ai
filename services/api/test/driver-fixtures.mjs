import assert from 'node:assert/strict';

// Tiny fictional image; never use real identity documents in automated tests.
export const IMAGE = { name: 'fixture.png', mimeType: 'image/png',
  base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aA3cAAAAASUVORK5CYII=' };
export const DETAILS = { legalName: 'Fictional Test Driver', phone: '+2348000000000', licenceNumber: 'TEST-LICENCE-ONLY',
  vehicle: { make: 'Toyota', model: 'Corolla', year: 2020, colour: 'Yellow', plate: 'TEST-DRIVER' } };
export const CHECKS = { identity: true, licence: true, vehicle: true, insurance: true };
export const KINDS = ['profile_photo', 'driving_licence', 'vehicle_registration', 'insurance', 'vehicle_photo'];
export async function submitApplication(api, expiresOn = '2099-12-31', details = DETAILS) {
  let { application } = await api.request('/api/driver/application');
  ({ application } = await api.command('/api/driver/application/save', { expectedVersion: application.version, details }));
  for (const kind of KINDS) {
    ({ application } = await api.command('/api/driver/application/upload', { expectedVersion: application.version, kind, ...IMAGE,
      expiresOn: kind.endsWith('photo') ? null : expiresOn }));
  }
  return (await api.command('/api/driver/application/submit', { expectedVersion: application.version })).application;
}
export async function approveApplication(api, id) {
  const { application } = await api.request(`/api/admin/drivers/${id}`);
  for (const document of application.documents) await api.request(`/api/driver-documents/${document.id}`);
  return (await api.command(`/api/admin/drivers/${id}/review`, { expectedVersion: application.version, decision: 'approved',
    reason: 'Fictional fixtures reviewed for automated testing only.', reference: 'TEST-REVIEW-001', checks: CHECKS })).application;
}
export function fixtureApi(client) {
  const body = (result) => { assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body; };
  return { request: async (path) => body(await client.send(path)), command: async (path, data) => body(await client.post(path, data)) };
}
