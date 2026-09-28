import sharp from 'sharp';
import { check } from '../shared/errors.mjs';
import { createDriverDocumentCodec } from './driver-document-codec.mjs';

export function createVehiclePhotoCodec() {
  const codec = createDriverDocumentCodec(2 * 1024 * 1024);
  return Object.freeze({
    decode(image) {
      check(image && typeof image === 'object' && !Array.isArray(image)
        && Object.keys(image).length === 2 && Object.hasOwn(image,'mimeType') && Object.hasOwn(image,'base64'),
      'INVALID_PHOTO', 'Choose a JPEG or PNG vehicle photo.');
      return codec.decode({ ...image, name: image.mimeType === 'image/png' ? 'vehicle.png' : 'vehicle.jpg' });
    },
    async normalise(content) {
      try {
        const input = sharp(content, { limitInputPixels: 16_000_000, failOn: 'warning' }).timeout({seconds:3});
        const metadata = await input.metadata();
        check(['jpeg','png'].includes(metadata.format) && (metadata.pages ?? 1) === 1
          && metadata.width >= 160 && metadata.height >= 120, 'INVALID_PHOTO', 'Use a clear, single vehicle photo at least 160 × 120 pixels.');
        // Decode, orient and re-encode. EXIF/GPS and other metadata are not forwarded.
        const bytes = await input.rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
          .flatten({ background: '#fff' }).jpeg({ quality: 90 }).toBuffer();
        return { base64: bytes.toString('base64') };
      } catch { check(false, 'INVALID_PHOTO', 'Use a readable JPEG or PNG vehicle photo, 160 × 120 pixels or larger, up to 16 megapixels.'); }
    },
  });
}
