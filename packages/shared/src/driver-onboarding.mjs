export const DRIVER_DOCUMENTS = Object.freeze({
  profile_photo: Object.freeze({ label: 'Driver selfie', expires: false, required: true }),
  driving_licence: Object.freeze({ label: 'Driving licence (front)', expires: true, required: true }),
  vehicle_registration: Object.freeze({ label: 'Vehicle document', expires: true, required: true }),
  insurance: Object.freeze({ label: 'Insurance document (optional / legacy)', expires: true, required: false }),
  vehicle_photo: Object.freeze({ label: 'Vehicle photo showing number plate', expires: false, required: true }),
});
export const DRIVER_REQUIRED_DOCUMENTS = Object.freeze(Object.keys(DRIVER_DOCUMENTS).filter((kind) => DRIVER_DOCUMENTS[kind].required));
export const DRIVER_REVIEW_CHECKS = Object.freeze({
  identity: 'Identity and driver photo checked', licence: 'Licence details and validity checked',
  vehicle: 'Vehicle category, load capacity (for deliveries), number plate and documents checked',
});
export const DRIVER_APPLICATION_LABELS = Object.freeze({ draft: 'Draft', submitted: 'Awaiting review',
  changes_requested: 'Corrections requested', rejected: 'Rejected', approved: 'Review approved' });
export const MAX_DRIVER_FILE_BYTES = 2 * 1024 * 1024;

// End of the stated calendar day in Nigeria (WAT, UTC+1), as an exclusive deadline.
export function driverDocumentDeadline(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const midnight = Date.parse(value + 'T00:00:00Z');
  if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== value) return null;
  return midnight + 23 * 60 * 60 * 1000;
}
