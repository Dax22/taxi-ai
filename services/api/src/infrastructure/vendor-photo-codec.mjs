import sharp from 'sharp';
import { check } from '../shared/errors.mjs';

const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');

function validatePng(source, code) {
  check(source.length >= 45 && source.subarray(0, 8).equals(PNG_SIGNATURE)
    && source.readUInt32BE(8) === 13 && source.subarray(12, 16).toString() === 'IHDR',
  code, 'The photo type does not match its contents.');
  // libvips may read just the default frame of an APNG. Reject animation chunks
  // explicitly instead of accidentally approving only the first frame.
  for (let offset = 8; offset < source.length;) {
    check(offset + 12 <= source.length, code, 'The PNG photo is incomplete.');
    const length = source.readUInt32BE(offset), end = offset + length + 12;
    check(end <= source.length, code, 'The PNG photo is incomplete.');
    const type = source.subarray(offset + 4, offset + 8).toString();
    check(!['acTL', 'fcTL', 'fdAT'].includes(type), code, 'Choose a single photo rather than an animation.');
    if (type === 'IEND') {
      check(length === 0 && end === source.length, code, 'The PNG photo contains unexpected data.');
      return;
    }
    offset = end;
  }
  check(false, code, 'The PNG photo is incomplete.');
}

/** Shared decoding boundary for dish, branding and private menu-reference photos.
 * Options are internal policy, never accepted from upload request bodies.
 * Return a fresh JPEG with orientation applied and EXIF/GPS/XMP/IPTC stripped.
 */
export async function normalizeVendorPhoto(image, {
  errorCode = 'INVALID_IMAGE', maxDimension = 1200, maxOutputBytes = 1024 * 1024,
  maxInputPixels = 32_000_000, quality = 82, minWidth = 160, minHeight = 120,
} = {}) {
  check(image && typeof image === 'object' && !Array.isArray(image)
    && Object.keys(image).length === 2 && ['mimeType', 'base64'].every((key) => Object.hasOwn(image, key))
    && ['image/jpeg', 'image/png'].includes(image.mimeType), errorCode, 'Choose a JPEG or PNG photo.');
  const { base64 } = image;
  check(typeof base64 === 'string' && base64.length > 0 && base64.length <= Math.ceil(MAX_INPUT_BYTES / 3) * 4
    && base64.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(base64),
  errorCode, 'Choose a photo up to 2 MiB.');
  const source = Buffer.from(base64, 'base64');
  check(source.length <= MAX_INPUT_BYTES && source.toString('base64') === base64,
    errorCode, 'The photo encoding is invalid.');
  if (image.mimeType === 'image/png') validatePng(source, errorCode);
  else check(source.length >= 16 && source[0] === 255 && source[1] === 216 && source[2] === 255
    && source.at(-2) === 255 && source.at(-1) === 217, errorCode, 'The photo type does not match its contents.');

  try {
    const input = sharp(source, { limitInputPixels: maxInputPixels, failOn: 'warning' }).timeout({ seconds: 3 });
    const metadata = await input.metadata();
    check(metadata.format === (image.mimeType === 'image/png' ? 'png' : 'jpeg'),
      errorCode, 'The photo type does not match its contents.');
    check((metadata.pages ?? 1) === 1 && metadata.width >= minWidth && metadata.height >= minHeight,
      errorCode, `Choose a clear, single photo at least ${minWidth} × ${minHeight} pixels.`);
    const content = await input.rotate().resize({ width: maxDimension, height: maxDimension, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#fff' }).jpeg({ quality }).toBuffer();
    check(content.length <= maxOutputBytes, errorCode, 'The photo is too detailed. Choose a smaller image.');
    return content;
  } catch (error) {
    if (error?.code === errorCode) throw error;
    check(false, errorCode, `Choose a readable JPEG or PNG photo up to ${maxInputPixels / 1_000_000} megapixels.`);
  }
}
