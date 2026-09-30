import { normalizeVendorPhoto } from './vendor-photo-codec.mjs';

/** Re-encode seller images to bounded JPEGs, stripping metadata before storage. */
export async function normalizeDishPhoto(image) {
  return normalizeVendorPhoto(image);
}
