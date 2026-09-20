/** Shared presentation only. Registration and approval remain server decisions. */
export const VEHICLE_MAKES = Object.freeze({
  Toyota: Object.freeze(['Camry', 'Corolla', 'Highlander', 'RAV4', 'Yaris']),
  Honda: Object.freeze(['Accord', 'Civic', 'CR-V', 'Fit']),
  Hyundai: Object.freeze(['Accent', 'Elantra', 'Santa Fe', 'Sonata', 'Tucson']),
  Kia: Object.freeze(['Cerato', 'Optima', 'Picanto', 'Rio', 'Sportage']),
  Nissan: Object.freeze(['Altima', 'Almera', 'Sentra', 'X-Trail']),
  Lexus: Object.freeze(['ES', 'GX', 'IS', 'RX']),
  'Mercedes-Benz': Object.freeze(['A-Class', 'C-Class', 'E-Class', 'GLC']),
  BMW: Object.freeze(['3 Series', '5 Series', 'X3', 'X5', 'X6']),
  Ford: Object.freeze(['Edge', 'Escape', 'Focus', 'Fusion']),
  Volkswagen: Object.freeze(['Golf', 'Jetta', 'Passat', 'Tiguan']),
  Peugeot: Object.freeze(['307', '308', '408', '508']),
  Suzuki: Object.freeze(['Alto', 'Baleno', 'Swift', 'Vitara']),
});
// Suggestions are not an eligibility list or a claim of model-year coverage.
export function modelsForMake(make) {
  const key = Object.keys(VEHICLE_MAKES).find((name) => name.toLowerCase() === make.trim().toLowerCase());
  return key ? VEHICLE_MAKES[key] : [];
}
export const VEHICLE_COLOURS = Object.freeze([
  { id: 'white', name: 'White', hex: '#ECEDEB' }, { id: 'silver', name: 'Silver', hex: '#AAB2BA' },
  { id: 'grey', name: 'Grey', hex: '#727A82' }, { id: 'black', name: 'Black', hex: '#343A42' },
  { id: 'blue', name: 'Blue', hex: '#3478BA' }, { id: 'red', name: 'Red', hex: '#BE4149' },
  { id: 'green', name: 'Green', hex: '#417465' }, { id: 'yellow', name: 'Yellow', hex: '#F4B400' },
  { id: 'gold', name: 'Gold', hex: '#B49A62' }, { id: 'brown', name: 'Brown', hex: '#806451' },
].map(Object.freeze));
export function vehicleColour(value) {
  const key = typeof value === 'string' ? value.trim().toLowerCase().replace(/^gray$/, 'grey') : '';
  return VEHICLE_COLOURS.find((c) => c.id === key) ?? null;
}
export function vehiclePresentation(vehicle = {}) {
  const make = vehicle.make?.trim() ?? '', model = (vehicle.modelName ?? vehicle.model)?.trim() ?? '';
  const title = !make || model.toLowerCase().startsWith(make.toLowerCase() + ' ') ? model : `${make} ${model}`.trim();
  const colour = vehicleColour(vehicle.colour), year = Number.isInteger(vehicle.year) ? String(vehicle.year) : '';
  return Object.freeze({ title: title || 'Your vehicle', plate: vehicle.plate?.trim().toUpperCase() || 'NUMBER PLATE',
    description: [year, vehicle.colour?.trim()].filter(Boolean).join(' · ') || 'Add your year and colour',
    colourId: colour?.id ?? 'neutral', paint: colour?.hex ?? '#AAB2BA',
    illustrationNote: colour ? 'Illustration, not an exact model. Check the vehicle and plate.'
      : 'Illustration only; model and colour are not represented.',
    // No exact-model claim until an asset has been licensed and checked against its generation/trim.
    visualMatch: 'illustration', assetPath: `/assets/vehicles/sedan-${colour?.id ?? 'neutral'}.svg` });
}
