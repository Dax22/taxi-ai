export const VEHICLE_PHOTO_CONSENT = 'vehicle-photo-v1';
export const PHOTO_CHECK_NOTICE = 'Send this vehicle photo to OpenAI for an AI comparison? Avoid people and unrelated details. Taxi AI removes image metadata and does not save the photo. Results expire after 24 hours unless you attach one to a report. Provider retention may apply.';
export const CHECK_LABELS = Object.freeze({ possible_match:'Plate appears to match',possible_mismatch:'Possible different vehicle',
  inconclusive:'Photo is inconclusive',pending:'Checking photo…',unavailable:'Photo check unavailable',trip_ended:'Pickup has ended' });
export const CHECK_GUIDANCE = Object.freeze({
  possible_match:'Check the physical plate, driver and vehicle yourself before sharing your PIN. A matching photo does not prove vehicle identity or safety.',
  possible_mismatch:'Compare the details below. If the actual vehicle differs, do not board or share your PIN. You can report the concern for review.',
  inconclusive:'Take a clearer photo showing one vehicle and its entire number plate. Compare the physical vehicle yourself.',
  pending:'Refresh to recover the result. Sending the same request again will not start another analysis.',
  unavailable:'AI could not complete this check. Compare the vehicle yourself; you can still report a concern.',
  trip_ended:'This check cannot confirm a current pickup. Open the journey for its latest status.',
});
export const CHECK_FIELDS = Object.freeze({ plate:'Number plate',make:'Make',model:'Model (reference only)',body:'Vehicle type',colour:'Colour' });
const id = v => typeof v === 'string' && /^[a-f0-9-]{36}$/.test(v);
const string = v => typeof v === 'string' && v.length>0 && v.length<=180 && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(v);
const expect = condition => { if (!condition) throw new Error('Invalid vehicle check response.'); };
export function readVehicleCheck(v,rideId) {
  expect(v && id(v.id) && v.rideId === rideId && Object.hasOwn(CHECK_LABELS,v.outcome)
    && Number.isSafeInteger(v.createdAt) && Number.isSafeInteger(v.expiresAt) && v.expiresAt>v.createdAt && typeof v.current === 'boolean'
    && Array.isArray(v.fields) && v.fields.length<=5 && new Set(v.fields.map(f=>f?.key)).size===v.fields.length
    && v.fields.every(f=>f && Object.hasOwn(CHECK_FIELDS,f.key) && string(f.expected) && string(f.observed) && ['match','different','unclear'].includes(f.status))
    && Array.isArray(v.reasons) && v.reasons.length<=5 && v.reasons.every(string));
  return v;
}
export function readVehicleChecks(v,rideId) {
  expect(v && id(rideId) && v.rideId===rideId && typeof v.enabled==='boolean' && typeof v.canCheck==='boolean'
    && (v.provider===null || v.provider==='OpenAI') && v.consentVersion===VEHICLE_PHOTO_CONSENT && Array.isArray(v.checks) && v.checks.length<=5);
  v.checks.forEach(c=>readVehicleCheck(c,rideId)); return v;
}
