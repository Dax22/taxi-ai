import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { vehiclePresentation, vehicleColour, modelsForMake, VEHICLE_COLOURS } from '../src/vehicle-profile.mjs';
import { VEHICLE_CATEGORIES } from '../src/vehicle-categories.mjs';

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

test('untrusted car fields cannot change artwork URLs and web/native share bounded bundled PNG assets', async () => {
  const malicious = 'red\"/><script>alert(1)</script>';
  assert.equal(vehiclePresentation({ colour:malicious,model:malicious,plate:malicious }).assetPath,'/assets/vehicles/sedan-neutral.png');
  const files = new Set([...VEHICLE_COLOURS.map(({ id }) => `sedan-${id}.png`), 'sedan-neutral.png',
    ...VEHICLE_CATEGORIES.map(({ assetPath }) => assetPath.split('/').at(-1))]);
  for (const file of files) {
    const asset = await readFile(new URL(`../../../apps/web/public/assets/vehicles/${file}`,import.meta.url));
    const native = await readFile(new URL(`../../../apps/mobile/src/assets/vehicles/${file === 'sedan-neutral.png' ? 'sedan-white.png' : file}`,import.meta.url));
    assert.deepEqual(asset.subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]));
    assert.deepEqual(asset,native); assert.ok(asset.length < (file.startsWith('sedan-') ? 350_000 : 450_000));
    assert.equal(asset.readUInt32BE(16),768); assert.equal(asset.readUInt32BE(20),512);
    assert.equal(asset[25],6); // PNG RGBA: preserve full colour and generated alpha.
  }
});
