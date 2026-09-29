import sharp from 'sharp';

const MAX_BYTES = 2 * 1024 * 1024;

/** Decode and re-encode privately in memory; no metadata or original file leaves this adapter. */
export async function normalizeDriverFaceImage(content) {
  try {
    if (!(content instanceof Uint8Array) || !content.length || content.length > MAX_BYTES) throw new Error();
    const input = sharp(content, { limitInputPixels: 24_000_000, failOn: 'error' }).timeout({ seconds: 3 });
    const metadata = await input.metadata();
    if (!['jpeg', 'png'].includes(metadata.format) || (metadata.pages ?? 1) !== 1
      || metadata.width < 160 || metadata.height < 160) throw new Error();
    const normalized = await input.rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer();
    if (normalized.length > MAX_BYTES) throw new Error();
    return normalized;
  } catch {
    // Never propagate decoder errors: they can include untrusted metadata or file content.
    throw new Error('Choose a readable JPEG or PNG image, at least 160 by 160 pixels and up to 2 MiB.');
  }
}
