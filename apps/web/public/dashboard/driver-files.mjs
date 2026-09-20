import { MAX_DRIVER_FILE_BYTES } from '/shared/driver-onboarding.mjs';

/** Browser file I/O only; requests and authorisation belong to the API. */
export const driverFiles = Object.freeze({
  async read(file) {
    if (!file || !['image/png', 'image/jpeg'].includes(file.type) || file.size <= 0 || file.size > MAX_DRIVER_FILE_BYTES) {
      throw new Error('Choose a PNG or JPEG image up to 2 MiB.');
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return { name: file.name, mimeType: file.type, base64: btoa(binary) };
  },
  save({ document: metadata, base64 }) {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
    const link = document.createElement('a'); link.href = url; link.download = metadata.downloadName;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
});
