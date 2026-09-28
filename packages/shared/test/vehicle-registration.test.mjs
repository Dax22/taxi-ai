import test from 'node:test';
import assert from 'node:assert/strict';
import { vehicleRegistrationYears, isVehicleRegistrationYear, vehicleChoice, OTHER_VEHICLE_CHOICE } from '../src/vehicle-registration.mjs';
import { modelsForMake, VEHICLE_MAKES } from '../src/vehicle-profile.mjs';

test('registration years include 2000 through the current UTC year and roll over at New Year', () => {
  const end = Date.parse('2026-12-31T23:59:59.999Z');
  assert.deepEqual(vehicleRegistrationYears(end),Array.from({ length:27 },(_,i) => 2026-i));
  for (const year of [2000,2026]) assert.equal(isVehicleRegistrationYear(year,end),true);
  for (const year of [1999,2027,'2020',2000.5,NaN,Infinity,null]) assert.equal(isVehicleRegistrationYear(year,end),false);
  assert.equal(isVehicleRegistrationYear(2027,end+1),true);
  assert.equal(vehicleRegistrationYears(end+1)[0],2027);
});

test('known choices canonicalise case, blank choices stay empty and unlisted vehicles remain custom', () => {
  const makes = Object.keys(VEHICLE_MAKES);
  assert.equal(vehicleChoice(' toyota ',makes),'Toyota');
  assert.equal(vehicleChoice('',makes),'');
  assert.equal(vehicleChoice('Unlisted make',makes),OTHER_VEHICLE_CHOICE);
  assert.equal(vehicleChoice('Corolla',modelsForMake('Honda')),OTHER_VEHICLE_CHOICE);
  assert.equal(vehicleChoice(' civic ',modelsForMake('Honda')),'Civic');
});
