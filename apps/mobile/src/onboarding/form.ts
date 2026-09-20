import type { DriverDetails, Vehicle } from '../../../../packages/shared/src/mobile-contracts.mjs';
export interface DriverDraft { legalName: string; phone: string; licenceNumber: string; make: string; model: string; year: string; colour: string; plate: string }
export function draftFromDetails(details: DriverDetails | null, vehicle?: Vehicle, name = ''): DriverDraft {
  const v = details?.vehicle ?? vehicle;
  return { legalName: details?.legalName ?? name, phone: details?.phone ?? '', licenceNumber: details?.licenceNumber ?? '',
    make: v?.make ?? '', model: (v && 'modelName' in v ? v.modelName : '') || v?.model || '',
    year: v?.year ? String(v.year) : '', colour: v?.colour ?? '', plate: v?.plate ?? '' };
}
export function detailsFromDraft(draft: DriverDraft): DriverDetails {
  const d = Object.fromEntries(Object.entries(draft).map(([k,v]) => [k,v.trim()])) as unknown as DriverDraft;
  for (const [key, label, min, max] of [['legalName','Full legal name',2,100], ['licenceNumber','Licence number',3,40],
    ['make','Vehicle make',2,40], ['model','Vehicle model',2,80], ['colour','Vehicle colour',2,30], ['plate','Number plate',2,15]] as const) {
    if (d[key].length < min || d[key].length > max) throw new Error(`${label} must have ${min}–${max} characters.`);
  }
  if (!/^\+[1-9]\d{7,14}$/.test(d.phone)) throw new Error('Use an international contact number, starting with +234 for Nigeria.');
  if (!/^\d{4}$/.test(d.year) || Number(d.year) < 1980 || Number(d.year) > 2100) throw new Error('Enter a four-digit vehicle year between 1980 and 2100.');
  if (!/^[A-Z0-9 -]+$/.test(d.plate.toUpperCase())) throw new Error('Use letters, numbers, spaces or dashes for the number plate.');
  return { legalName: d.legalName, phone: d.phone, licenceNumber: d.licenceNumber,
    vehicle: { make: d.make, model: d.model, year: Number(d.year), colour: d.colour, plate: d.plate.toUpperCase() } };
}
