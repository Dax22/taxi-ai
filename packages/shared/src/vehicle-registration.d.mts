export const MIN_VEHICLE_YEAR: 2000;
export const OTHER_VEHICLE_CHOICE: '__other__';
export function vehicleRegistrationYears(now?: number): number[];
export function isVehicleRegistrationYear(year: unknown, now?: number): boolean;
export function vehicleYearMessage(now?: number): string;
export function vehicleChoice(value: string, choices: readonly string[]): string;
