import { MAX_DRIVER_FILE_BYTES } from '../../../../packages/shared/src/driver-onboarding.mjs';
export interface DriverFile { name: string; mimeType: 'image/png' | 'image/jpeg'; base64: string }
export interface SelectedImage { uri: string; name: string; mimeType?: string }
export interface CachedFile { readonly exists: boolean; readonly size: number; base64(): Promise<string>; delete(): void }

/** The original file is never removed; only the system picker's app-cache copy is read/deleted. */
export async function readDriverFile(asset: SelectedImage, file: CachedFile, cacheUri: string): Promise<DriverFile> {
  const cached = asset.uri.startsWith(cacheUri + (cacheUri.endsWith('/') ? '' : '/'));
  try {
    if (!cached || !['image/png','image/jpeg'].includes(asset.mimeType ?? '') || !file.exists || file.size <= 0 || file.size > MAX_DRIVER_FILE_BYTES) {
      throw new Error('Choose a PNG or JPEG image up to 2 MiB. Export HEIC photos as JPEG first.');
    }
    const mimeType = asset.mimeType as DriverFile['mimeType'], extension = mimeType === 'image/png' ? '.png' : '.jpg';
    const stem = asset.name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9 _-]/g, '_').replace(/^[^A-Za-z0-9]+/, '').slice(0,80) || 'driver-document';
    const base64 = await file.base64();
    if (base64.length > Math.ceil(MAX_DRIVER_FILE_BYTES / 3) * 4) throw new Error('Choose an image up to 2 MiB.');
    return { name: stem + extension, mimeType, base64 };
  } finally { if (cached && file.exists) file.delete(); }
}
