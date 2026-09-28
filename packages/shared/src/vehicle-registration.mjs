/** Choices assist entry; documents and manual review establish vehicle identity. */
export const MIN_VEHICLE_YEAR = 2000;
export const OTHER_VEHICLE_CHOICE = '__other__';
export function vehicleRegistrationYears(now = Date.now()) {
  const latest = new Date(now).getUTCFullYear();
  if (!Number.isInteger(latest) || latest < MIN_VEHICLE_YEAR) return [];
  return Array.from({ length: latest - MIN_VEHICLE_YEAR + 1 }, (_, i) => latest - i);
}
export function isVehicleRegistrationYear(year, now = Date.now()) {
  return Number.isInteger(year) && year >= MIN_VEHICLE_YEAR && year <= new Date(now).getUTCFullYear();
}
export function vehicleYearMessage(now = Date.now()) {
  return `Choose a vehicle year from ${MIN_VEHICLE_YEAR} to ${new Date(now).getUTCFullYear()}.`;
}
/** Unknown saved values remain explicit custom entries, never the first option. */
export function vehicleChoice(value, choices) {
  const text = typeof value === 'string' ? value.trim() : '';
  return choices.find((choice) => choice.toLowerCase() === text.toLowerCase()) ?? (text ? OTHER_VEHICLE_CHOICE : '');
}
