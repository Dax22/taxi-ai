import sharp from 'sharp';
import { check } from '../shared/errors.mjs';

const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024;

/** Re-encode seller images to bounded JPEGs, stripping metadata before storage. */
export async function normalizeDishPhoto(image) {
  check(image && typeof image === 'object' && !Array.isArray(image)
    && Object.keys(image).length === 2 && ['mimeType', 'base64'].every((key) => Object.hasOwn(image, key))
    && ['image/jpeg', 'image/png'].includes(image.mimeType), 'INVALID_IMAGE', 'Choose a JPEG or PNG food photo.');
  const base64 = image.base64;
  check(typeof base64 === 'string' && base64.length > 0 && base64.length <= Math.ceil(MAX_INPUT_BYTES / 3) * 4
    && base64.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(base64),
  'INVALID_IMAGE', 'Choose a food photo up to 2 MiB.');
  const source = Buffer.from(base64, 'base64');
  check(source.length <= MAX_INPUT_BYTES && source.toString('base64') === base64, 'INVALID_IMAGE', 'The photo encoding is invalid.');
  let metadata, content;
  try {
    const input = sharp(source, { limitInputPixels: 32_000_000, failOn: 'error' });
    metadata = await input.metadata();
    check((image.mimeType === 'image/jpeg' && metadata.format === 'jpeg')
      || (image.mimeType === 'image/png' && metadata.format === 'png'), 'INVALID_IMAGE', 'The photo type does not match its contents.');
    check(metadata.width >= 160 && metadata.height >= 120, 'INVALID_IMAGE', 'Choose a clearer food photo at least 160 × 120 pixels.');
    content = await input.rotate().resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 }).toBuffer();
  } catch (error) {
    if (error?.code === 'INVALID_IMAGE') throw error;
    check(false, 'INVALID_IMAGE', 'The photo could not be read. Choose another JPEG or PNG image.');
  }
  check(content.length <= MAX_OUTPUT_BYTES, 'INVALID_IMAGE', 'The photo is too detailed. Choose a smaller image.');
  return content;
}
