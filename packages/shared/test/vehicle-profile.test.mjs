import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { vehiclePresentation, vehicleColour, modelsForMake, VEHICLE_COLOURS } from '../src/vehicle-profile.mjs';
import { vehicleArtwork } from '../src/vehicle-artwork.mjs';

test('structured and legacy vehicles keep a readable plate without duplicated makes or invented colour/model matches', () => {
  const current = { make:'Toyota',model:'Toyota Corolla',modelName:'Corolla',year:2020,colour:'Silver',plate:'abc-123' };
  const card = vehiclePresentation(current);
  assert.equal(card.title,'Toyota Corolla'); assert.equal(card.plate,'ABC-123'); assert.equal(card.description,'2020 · Silver');
  assert.equal(card.colourId,'silver'); assert.equal(card.visualMatch,'illustration');
  assert.equal(vehiclePresentation({ model:'Honda Accord',plate:'TEST' }).title,'Honda Accord');
  const other = vehiclePresentation({ ...current,colour:'Blue and white' });
  assert.equal(other.colourId,'neutral'); assert.match(other.description,/Blue and white/); assert.match(other.illustrationNote,/not represented/);
  assert.equal(vehicleColour('GRAY').id,'grey'); assert.ok(modelsForMake(' toyota ').includes('Corolla'));
  assert.deepEqual(modelsForMake('Unlisted make'),[]);
});

test('untrusted car fields cannot change artwork URLs or SVG markup and web/native illustrations share identical assets', async () => {
  const malicious = 'red\"/><script>alert(1)</script>';
  assert.equal(vehiclePresentation({ colour:malicious,model:malicious,plate:malicious }).assetPath,'/assets/vehicles/sedan-neutral.svg');
  assert.ok(!vehicleArtwork(malicious).includes('<script>'));
  for (const colour of [...VEHICLE_COLOURS,{ id:'neutral' }]) {
    const asset = await readFile(new URL(`../../../apps/web/public/assets/vehicles/sedan-${colour.id}.svg`,import.meta.url),'utf8');
    assert.equal(asset,vehicleArtwork(colour.id)+'\n');
    assert.ok(!asset.includes('TEST-'));
  }
});
