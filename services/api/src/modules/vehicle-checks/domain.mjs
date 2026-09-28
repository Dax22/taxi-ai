import { observation, VEHICLE_COLOURS } from '../../shared/vehicle-observation.mjs';

const normal = value => typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g,' ') : '';
const plate = value => normal(value).toUpperCase().replace(/[ -]/g,'');
const colour = value => { const v = normal(value).replace(/^gray$/,'grey'); return VEHICLE_COLOURS.includes(v) && !['other','unknown'].includes(v) ? v : null; };
const body = { standard:'sedan',suv:'suv',van:'van',truck:'truck',motorcycle:'motorcycle' };
const field = (key, expected, observed, clear, normalize = normal) => ({ key, expected: expected || 'Not recorded', observed: observed || 'Unclear',
  status: clear && expected && observed ? normalize(expected) === normalize(observed) ? 'match' : 'different' : 'unclear' });

/** Rules, not the model, determine the comparison. No identity or safety guarantee. */
export function compareVehicle(expected, raw) {
  const seen = observation(raw), usable = seen.quality === 'usable' && seen.vehicles === 'one';
  const appearance = usable && seen.appearanceClear;
  const fields = [
    field('plate',expected.plate,seen.plate,usable && seen.plateReadable && /^[A-Z0-9]{3,15}$/.test(plate(seen.plate)),plate),
    field('make',expected.make,seen.make,appearance),
    // Model variants and trims are displayed, never treated as a reliable mismatch.
    field('model',expected.modelName ?? expected.model,seen.model,false),
    field('body',body[expected.category ?? 'standard'],seen.bodyType === 'unknown' || seen.bodyType === 'other' ? null : seen.bodyType,appearance),
    field('colour',expected.colour,seen.colour === 'unknown' || seen.colour === 'other' ? null : seen.colour,appearance && Boolean(colour(expected.colour)),colour),
  ];
  const differences = fields.filter(f => f.status === 'different').map(f => f.key);
  const outcome = !usable ? 'inconclusive' : differences.length ? 'possible_mismatch'
    : fields[0].status === 'match' ? 'possible_match' : 'inconclusive';
  return { outcome, fields, reasons: !usable ? [seen.vehicles === 'multiple' ? 'multiple_vehicles' : seen.vehicles === 'none' ? 'no_vehicle' : 'unclear_photo']
    : differences.length ? differences.map(k => `${k}_differs`) : fields[0].status === 'match' ? ['plate_matches'] : ['plate_unreadable'] };
}
