import { createHash } from 'node:crypto';
import { check } from '../shared/errors.mjs';

/** Bounded image envelope validation, not malware scanning or identity verification. */
export function createDriverDocumentCodec(maxBytes) {
  return Object.freeze({
    decode({ name, mimeType, base64 }) {
      check(typeof name === 'string' && name.length <= 100 && /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,95}\.(png|jpg|jpeg)$/i.test(name)
        && !name.includes('..'), 'INVALID_DOCUMENT', 'Use a simple PNG or JPEG filename, up to 100 characters.');
      check(typeof base64 === 'string' && base64.length > 0 && base64.length <= Math.ceil(maxBytes / 3) * 4
        && base64.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(base64),
      'INVALID_DOCUMENT', 'Upload a PNG or JPEG image up to 2 MiB.');
      const content = Buffer.from(base64, 'base64');
      check(content.length <= maxBytes && content.toString('base64') === base64, 'INVALID_DOCUMENT', 'Invalid image encoding.');
      const png = mimeType === 'image/png' && /\.png$/i.test(name) && content.length >= 45
        && content.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
        && content.subarray(12, 16).toString() === 'IHDR'
        && content.subarray(-12).equals(Buffer.from('0000000049454e44ae426082', 'hex'))
        && content.readUInt32BE(16) > 0 && content.readUInt32BE(20) > 0
        && content.readUInt32BE(16) * content.readUInt32BE(20) <= 16_000_000;
      const jpeg = mimeType === 'image/jpeg' && /\.jpe?g$/i.test(name) && content.length >= 16
        && content[0] === 255 && content[1] === 216 && content[2] === 255
        && content.at(-2) === 255 && content.at(-1) === 217;
      check(png || jpeg, 'INVALID_DOCUMENT', 'The image contents, type and filename must agree. PDF, SVG and other formats are not accepted.');
      return { name, mimeType, content, sizeBytes: content.length, sha256: createHash('sha256').update(content).digest('hex') };
    },
    encode(content) { return Buffer.from(content).toString('base64'); },
  });
}
