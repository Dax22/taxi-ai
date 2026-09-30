import { fields } from '../shared/validation.mjs';
import { normalizeVendorPhoto } from './vendor-photo-codec.mjs';

/** Full decoding, orientation and fresh encoding removes EXIF/GPS before publication. */
export async function normaliseFoodPhoto(photo) {
  fields(photo, ['mimeType', 'base64']);
  const bytes = await normalizeVendorPhoto(photo, {
    errorCode: 'INVALID_PHOTO', maxDimension: 960, maxOutputBytes: 350_000, maxInputPixels: 16_000_000, quality: 78,
  });
  return bytes.toString('base64');
}
