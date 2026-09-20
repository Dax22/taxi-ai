import { check } from '../../shared/errors.mjs';
import { fields, label } from '../../shared/validation.mjs';
import { DRIVER_DOCUMENTS, driverDocumentDeadline } from '../../../../../packages/shared/src/driver-onboarding.mjs';
import { isVehicleRegistrationYear, vehicleYearMessage } from '../../../../../packages/shared/src/vehicle-registration.mjs';

export function vehicleDetails(data, now = Date.now()) {
  fields(data, ['make', 'model', 'year', 'colour', 'plate']);
  const year = data.year;
  check(isVehicleRegistrationYear(year, now), 'INVALID_INPUT', vehicleYearMessage(now));
  const plate = label(data.plate, 'Number plate', 2, 15).toUpperCase();
  check(/^[A-Z0-9 -]+$/.test(plate), 'INVALID_INPUT', 'Use letters, numbers, spaces or dashes for the number plate.');
  return { make: label(data.make, 'Vehicle make', 2, 40), model: label(data.model, 'Vehicle model', 2, 80),
    year, colour: label(data.colour, 'Vehicle colour', 2, 30), plate };
}

export function applicationDetails(data, now = Date.now()) {
  fields(data, ['legalName', 'phone', 'licenceNumber', 'vehicle']);
  const vehicle = vehicleDetails(data.vehicle, now);
  const phone = label(data.phone, 'Phone number', 9, 16);
  check(/^\+[1-9]\d{7,14}$/.test(phone), 'INVALID_INPUT', 'Use an international phone number, such as +234 followed by the number.');
  return { legalName: label(data.legalName, 'Legal name', 2, 100), phone,
    licenceNumber: label(data.licenceNumber, 'Licence number', 3, 40), vehicle };
}

export function documentExpiry(kind, value) {
  check(Object.hasOwn(DRIVER_DOCUMENTS, kind), 'INVALID_DOCUMENT', 'Choose a document category.');
  if (!DRIVER_DOCUMENTS[kind].expires) {
    check(value === null, 'INVALID_DOCUMENT', 'Photos do not need an expiry date.'); return null;
  }
  check(driverDocumentDeadline(value) !== null, 'INVALID_DOCUMENT', 'Use a valid expiry date in YYYY-MM-DD format.');
  return value;
}

export function eligibility(application, documents, now) {
  const missing = Object.keys(DRIVER_DOCUMENTS).filter((kind) => !documents.some((doc) => doc.kind === kind));
  const expired = documents.filter((doc) => DRIVER_DOCUMENTS[doc.kind].expires
    && (driverDocumentDeadline(doc.expiresOn) ?? 0) <= now).map((doc) => doc.kind);
  const deadlines = documents.filter((doc) => DRIVER_DOCUMENTS[doc.kind].expires).map((doc) => driverDocumentDeadline(doc.expiresOn) ?? 0);
  return { eligible: Boolean(application?.status === 'approved' && application.details && application.verification && !missing.length && !expired.length),
    reviewStatus: application?.status ?? 'draft', missing, expired, validUntil: deadlines.length ? Math.min(...deadlines) : null };
}

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
