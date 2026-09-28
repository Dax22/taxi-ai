import type { VehicleCategoryId } from '../../../../packages/shared/src/vehicle-categories.mjs';
import { transportCategory, validPayload } from '../../../../packages/shared/src/transport-categories.mjs';
import type { DriverDetails, Vehicle } from '../../../../packages/shared/src/mobile-contracts.mjs';
import { isVehicleRegistrationYear, vehicleYearMessage } from '../../../../packages/shared/src/vehicle-registration.mjs';
export interface DriverDraft { category?: VehicleCategoryId; payloadKg?: string; legalName: string; phone: string; licenceNumber: string; make: string; model: string; year: string; colour: string; plate: string }
export function draftFromDetails(details: DriverDetails | null, vehicle?: Vehicle, name = ''): DriverDraft {
  const v = details?.vehicle ?? vehicle;
  return { category: v?.category ?? 'standard', payloadKg: v?.payloadKg == null ? '' : String(v.payloadKg), legalName: details?.legalName ?? name, phone: details?.phone ?? '', licenceNumber: details?.licenceNumber ?? '',
    make: v?.make ?? '', model: (v && 'modelName' in v ? v.modelName : '') || v?.model || '',
    year: v?.year ? String(v.year) : '', colour: v?.colour ?? '', plate: v?.plate ?? '' };
}
export function detailsFromDraft(draft: DriverDraft, now = Date.now()): DriverDetails {
  const d = Object.fromEntries(Object.entries(draft).map(([k,v]) => [k,v.trim()])) as unknown as DriverDraft;
  for (const [key, label, min, max] of [['legalName','Full legal name',2,100], ['licenceNumber','Licence number',3,40],
    ['make','Vehicle make',2,40], ['model','Vehicle model',2,80], ['colour','Vehicle colour',2,30], ['plate','Number plate',2,15]] as const) {
    if (d[key].length < min || d[key].length > max) throw new Error(`${label} must have ${min}–${max} characters.`);
  }
  if (!/^\+[1-9]\d{7,14}$/.test(d.phone)) throw new Error('Use an international contact number, starting with +234 for Nigeria.');
  if (!/^\d{4}$/.test(d.year) || !isVehicleRegistrationYear(Number(d.year), now)) throw new Error(vehicleYearMessage(now));
  if (!/^[A-Z0-9 -]+$/.test(d.plate.toUpperCase())) throw new Error('Use letters, numbers, spaces or dashes for the number plate.');
  const category = d.category ?? 'standard', policy = transportCategory(category);
  if (!policy) throw new Error('Choose a vehicle category.');
  const payloadKg = policy.service === 'delivery' ? Number(d.payloadKg) : null;
  if (policy.service === 'delivery' && !validPayload(category, payloadKg)) throw new Error(`Enter the verified load capacity, above zero and up to ${policy.maxLoadKg} kg (preview limit).`);
  return { legalName: d.legalName, phone: d.phone, licenceNumber: d.licenceNumber,
    vehicle: { make: d.make, model: d.model, year: Number(d.year), colour: d.colour, plate: d.plate.toUpperCase(), category, payloadKg } };
}
