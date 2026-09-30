import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { normalizeDishPhoto } from '../src/infrastructure/eats-photo-codec.mjs';
import { normaliseFoodPhoto } from '../src/infrastructure/food-photo-codec.mjs';
import { normalizeVendorPhoto } from '../src/infrastructure/vendor-photo-codec.mjs';

const envelope = (bytes, mimeType = 'image/png') => ({ mimeType, base64: bytes.toString('base64') });
const photo = (width = 240, height = 180, background = '#f4b400') => sharp({ create: { width, height, channels: 4, background } });
const png = await photo().png().toBuffer();
const jpeg = await photo().jpeg().toBuffer();
const codecs = [
  { name: 'current dish', run: normalizeDishPhoto, code: 'INVALID_IMAGE', max: 1200, bytes: 1024 * 1024 },
  { name: 'legacy meal', run: async (image) => Buffer.from(await normaliseFoodPhoto(image), 'base64'), code: 'INVALID_PHOTO', max: 960, bytes: 350_000 },
];

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, payload) {
  const bytes = Buffer.alloc(payload.length + 12);
  bytes.writeUInt32BE(payload.length); bytes.write(type, 4); payload.copy(bytes, 8);
  bytes.writeUInt32BE(crc32(bytes.subarray(4, -4)), bytes.length - 4);
  return bytes;
}
function twoFramePng(source) {
  const parts = [];
  for (let offset = 8; offset < source.length;) {
    const size = source.readUInt32BE(offset);
    parts.push({ type: source.subarray(offset + 4, offset + 8).toString(), data: source.subarray(offset + 8, offset + size + 8) });
    offset += size + 12;
  }
  const ihdr = parts.find((part) => part.type === 'IHDR').data;
  const compressed = Buffer.concat(parts.filter((part) => part.type === 'IDAT').map((part) => part.data));
  const actl = Buffer.alloc(8); actl.writeUInt32BE(2);
  const control = (sequence) => {
    const data = Buffer.alloc(26); data.writeUInt32BE(sequence); ihdr.copy(data, 4, 0, 8);
    data.writeUInt16BE(100, 20); data.writeUInt16BE(1000, 22); return chunk('fcTL', data);
  };
  const fdat = Buffer.alloc(4 + compressed.length); fdat.writeUInt32BE(2); compressed.copy(fdat, 4);
  return Buffer.concat([source.subarray(0, 8), chunk('IHDR', ihdr), chunk('acTL', actl),
    control(0), chunk('IDAT', compressed), control(1), chunk('fdAT', fdat), chunk('IEND', Buffer.alloc(0))]);
}
function hasGpsDirectory(exif) {
  assert.equal(exif.subarray(0, 6).toString(), 'Exif\0\0');
  const tiff = exif.subarray(6), little = tiff.subarray(0, 2).toString() === 'II';
  const u16 = (offset) => little ? tiff.readUInt16LE(offset) : tiff.readUInt16BE(offset);
  const u32 = (offset) => little ? tiff.readUInt32LE(offset) : tiff.readUInt32BE(offset);
  const offset = u32(4);
  for (let i = 0; i < u16(offset); i++) {
    const entry = offset + 2 + i * 12;
    if (u16(entry) === 0x8825) return u16(u32(entry + 8)) > 0;
  }
  return false;
}

for (const codec of codecs) {
  test(`${codec.name} photo applies EXIF orientation and removes real GPS, EXIF, XMP and colour-profile metadata`, async () => {
    const sensitive = await sharp(jpeg).withMetadata({ orientation: 6 }).withExifMerge({
      IFD0: { Copyright: 'PRIVATE_KITCHEN_METADATA' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '41/1 52/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '87/1 38/1 0/1' },
    }).withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/">PRIVATE_KITCHEN_XMP</x:xmpmeta>').toBuffer();
    const inputMetadata = await sharp(sensitive).metadata();
    assert.equal(inputMetadata.orientation, 6); assert.ok(hasGpsDirectory(inputMetadata.exif));
    assert.ok(inputMetadata.xmp); assert.ok(inputMetadata.icc);
    const content = await codec.run(envelope(sensitive, 'image/jpeg'));
    const metadata = await sharp(content).metadata();
    assert.equal(metadata.format, 'jpeg'); assert.equal(metadata.width, 180); assert.equal(metadata.height, 240);
    for (const key of ['exif', 'xmp', 'iptc', 'icc', 'orientation']) assert.equal(metadata[key], undefined, key);
    assert.equal(content.includes(Buffer.from('PRIVATE_KITCHEN')), false);
  });

  test(`${codec.name} photo bounds dimensions and output bytes and flattens transparency on white`, async () => {
    const large = await photo(1800, 1500).png().toBuffer();
    const content = await codec.run(envelope(large)), metadata = await sharp(content).metadata();
    assert.equal(metadata.width, codec.max); assert.ok(metadata.height <= codec.max); assert.ok(content.length <= codec.bytes);
    const transparent = await photo(240, 180, { r: 0, g: 0, b: 0, alpha: 0 }).png().toBuffer();
    const { data, info } = await sharp(await codec.run(envelope(transparent))).raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.channels, 3); assert.deepEqual([...data.subarray(0, 3)], [255, 255, 255]);
  });

  test(`${codec.name} photo rejects spoofing, unsupported formats, malformed base64 and oversized uploads`, async () => {
    const inputs = [
      envelope(png, 'image/jpeg'), envelope(jpeg, 'image/png'),
      envelope(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="180"/>'), 'image/jpeg'),
      envelope(await photo().gif().toBuffer(), 'image/png'), envelope(png, 'image/svg+xml'),
      { mimeType: 'image/png', base64: '' }, { mimeType: 'image/png', base64: 'AB==' },
      { mimeType: 'image/png', base64: png.toString('base64') + '\n' },
      { mimeType: 'image/png', base64: 'data:image/png;base64,' + png.toString('base64') },
      envelope(Buffer.alloc(2 * 1024 * 1024 + 1)),
    ];
    for (const input of inputs) await assert.rejects(() => codec.run(input), { code: codec.code });
    await assert.rejects(() => codec.run({ ...envelope(png), url: 'https://example.test/photo' }));
    await assert.rejects(() => codec.run(null));
  });

  test(`${codec.name} photo rejects animated PNG, truncated and corrupt content, small and excessive-pixel images`, async () => {
    const hugeHeader = Buffer.from(png.subarray(16, 29)); hugeHeader.writeUInt32BE(8000); hugeHeader.writeUInt32BE(4001, 4);
    const huge = Buffer.concat([png.subarray(0, 8), chunk('IHDR', hugeHeader), png.subarray(33)]);
    const corrupt = Buffer.from(png); const idat = corrupt.indexOf(Buffer.from('IDAT')); corrupt[idat + 5] ^= 0xff;
    const inputs = [twoFramePng(png), png.subarray(0, -6), corrupt, huge,
      await photo(159, 120).png().toBuffer(), await photo(160, 119).png().toBuffer()];
    for (const bytes of inputs) await assert.rejects(() => codec.run(envelope(bytes)), { code: codec.code });
    await assert.rejects(() => codec.run(envelope(jpeg.subarray(0, -20), 'image/jpeg')), { code: codec.code });
  });
}

test('branding and private menu references use the same strict decoding boundary', async () => {
  const smallLogo = envelope(await photo(120, 120).png().toBuffer());
  const result = await normalizeVendorPhoto(smallLogo, { minWidth: 120, minHeight: 120, maxDimension: 600 });
  assert.ok(Buffer.isBuffer(result)); assert.equal((await sharp(result).metadata()).width, 120);
  await assert.rejects(() => normalizeVendorPhoto(envelope(twoFramePng(png)), { minWidth: 120 }), { code: 'INVALID_IMAGE' });
});
