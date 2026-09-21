import { vehiclePresentation } from './vehicle-profile.mjs';
import { vehicleCategory } from './vehicle-categories.mjs';

const clean = (value, max) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, max) : '';

/** Use the journey's approved snapshot, never artwork or the driver's later edits. */
export function arrivalNotice(driver) {
  if (!driver?.vehicle) return null;
  const vehicle = driver.vehicle;
  const name = clean(driver.name, 100) || 'Your driver';
  const model = vehiclePresentation({ make: clean(vehicle.make, 40), model: clean(vehicle.modelName ?? vehicle.model, 80) }).title;
  const category = vehicleCategory(vehicle.category ?? 'standard')?.name ?? 'Vehicle';
  const colour = clean(vehicle.colour, 30) || 'Colour not recorded';
  const plate = clean(vehicle.plate, 15).toUpperCase() || 'Plate not recorded';
  return Object.freeze({ title: 'Driver has arrived',
    body: `${name} has arrived. Number plate: ${plate}. ${model} · ${category} · ${colour}. Check the vehicle before sharing your pickup PIN.` });
}

// A rider-reported concern for manual review, not an automatic identity verdict.
export function vehicleMismatchReport(note = '') {
  if (typeof note !== 'string' || note.trim().length > 480) throw new Error('Describe the different vehicle in up to 480 characters.');
  return { kind: 'unsafe_behaviour', note: `Vehicle mismatch: ${note.trim() || 'The vehicle at pickup does not match the assigned vehicle.'}`, contactIds: [] };
}
