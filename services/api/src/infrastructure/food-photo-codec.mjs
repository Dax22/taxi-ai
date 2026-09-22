import sharp from 'sharp';
import { check } from '../shared/errors.mjs';
import { fields } from '../shared/validation.mjs';
import { createDriverDocumentCodec } from './driver-document-codec.mjs';

/** Full decoding, orientation and fresh encoding removes EXIF/GPS before publication. */
export async function normaliseFoodPhoto(photo) {
  fields(photo, ['mimeType', 'base64']);
  const source = createDriverDocumentCodec(2 * 1024 * 1024).decode({ ...photo, name: photo.mimeType === 'image/png' ? 'meal.png' : 'meal.jpg' });
  try {
    const input = sharp(source.content, { limitInputPixels: 16_000_000, failOn: 'warning' }).timeout({ seconds: 3 });
    const meta = await input.metadata();
    check(['jpeg', 'png'].includes(meta.format) && (meta.pages ?? 1) === 1 && meta.width >= 160 && meta.height >= 120, 'INVALID_PHOTO', 'Choose a clear, single meal photo.');
    const bytes = await input.rotate().resize({ width: 960, height: 960, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#fff' }).jpeg({ quality: 78 }).toBuffer();
    check(bytes.length <= 350_000, 'INVALID_PHOTO', 'Choose a simpler or smaller photo.');
    return bytes.toString('base64');
  } catch { check(false, 'INVALID_PHOTO', 'Choose a readable JPEG or PNG, at least 160 × 120 pixels and up to 16 megapixels.'); }
}
