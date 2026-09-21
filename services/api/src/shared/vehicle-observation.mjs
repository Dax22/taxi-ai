import { check } from './errors.mjs';

export const VEHICLE_COLOURS = ['black','white','silver','grey','blue','red','green','yellow','brown','gold','other','unknown'];
export const VEHICLE_BODIES = ['sedan','suv','van','truck','motorcycle','other','unknown'];
export const VEHICLE_OBSERVATION_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    quality: { type: 'string', enum: ['usable','unclear'] },
    vehicles: { type: 'string', enum: ['one','none','multiple'] },
    plate: { type: ['string','null'] }, plateReadable: { type: 'boolean' },
    make: { type: ['string','null'] }, model: { type: ['string','null'] },
    bodyType: { type: 'string', enum: VEHICLE_BODIES },
    colour: { type: 'string', enum: VEHICLE_COLOURS }, appearanceClear: { type: 'boolean' },
  },
  required: ['quality','vehicles','plate','plateReadable','make','model','bodyType','colour','appearanceClear'],
};
export function observation(value) {
  const text = (v, max) => v === null || typeof v === 'string' && v.length > 0 && v.length <= max
    && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(v);
  check(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === VEHICLE_OBSERVATION_SCHEMA.required.length
    && VEHICLE_OBSERVATION_SCHEMA.required.every(k => Object.hasOwn(value,k))
    && ['usable','unclear'].includes(value.quality) && ['one','none','multiple'].includes(value.vehicles)
    && text(value.plate,20) && (value.plate === null || /^[A-Za-z0-9 -]+$/.test(value.plate))
    && text(value.make,60) && text(value.model,80) && typeof value.plateReadable === 'boolean'
    && typeof value.appearanceClear === 'boolean' && VEHICLE_BODIES.includes(value.bodyType)
    && VEHICLE_COLOURS.includes(value.colour), 'INVALID_VISION_RESULT', 'The photo could not be read reliably.');
  return Object.fromEntries(VEHICLE_OBSERVATION_SCHEMA.required.map(k => [k,value[k]]));
}
