const MAX_SOURCE_BYTES = 8 * 1024 * 1024, MAX_UPLOAD_BYTES = 1024 * 1024;
const MAX_PIXELS = 25_000_000, MAX_EDGE = 1600;

export function photoDimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > MAX_PIXELS) throw new Error('Choose a photo no larger than 25 megapixels.');
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function validatePhotoFile(file) {
  if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size < 1 || file.size > MAX_SOURCE_BYTES) throw new Error('Choose a JPEG, PNG or WebP photo up to 8 MiB.');
}

function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason); signal.addEventListener('abort', aborted, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}

async function decode(file, signal) {
  if (typeof globalThis.createImageBitmap === 'function') {
    const decoding = globalThis.createImageBitmap(file).then((bitmap) => { if (signal.aborted) { bitmap.close(); throw signal.reason; } return bitmap; });
    return abortable(decoding, signal);
  }
  const uri = URL.createObjectURL(file), image = new Image();
  try {
    await abortable(new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('Could not read that photo. Choose a JPEG, PNG or WebP image.')); image.src = uri; }), signal);
    return { width: image.naturalWidth, height: image.naturalHeight, image, close() {} };
  } finally { if (signal.aborted) image.src = ''; image.onload = image.onerror = null; URL.revokeObjectURL(uri); }
}

/** Re-encode the whole image without location metadata, crop, or changes to the food. The server validates again. */
export async function prepareFoodPhoto(file, { timeoutMs = 15_000 } = {}) {
  validatePhotoFile(file);
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(new Error('Photo processing took too long. Choose a smaller photo and try again.')), timeoutMs);
  let bitmap;
  try {
    bitmap = await decode(file, controller.signal);
    const size = photoDimensions(bitmap.width, bitmap.height), canvas = document.createElement('canvas');
    canvas.width = size.width; canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Photo processing is unavailable in this browser. Try another browser.');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, size.width, size.height);
    context.drawImage(bitmap.image ?? bitmap, 0, 0, size.width, size.height);
    let blob;
    for (const quality of [0.86, 0.76, 0.65, 0.52]) {
      blob = await abortable(new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality)), controller.signal);
      if (blob && blob.type === 'image/jpeg' && blob.size <= MAX_UPLOAD_BYTES) break;
    }
    if (!blob || blob.type !== 'image/jpeg' || blob.size > MAX_UPLOAD_BYTES) throw new Error('This photo is too detailed to upload. Choose a smaller photo.');
    const bytes = new Uint8Array(await abortable(blob.arrayBuffer(), controller.signal));
    let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const base64 = btoa(binary);
    return { photo: { mimeType: 'image/jpeg', base64 }, preview: `data:image/jpeg;base64,${base64}` };
  } finally { clearTimeout(timer); bitmap?.close(); }
}
