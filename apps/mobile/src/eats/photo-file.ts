import { getDocumentAsync } from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
export interface MealPhoto { mimeType: 'image/jpeg' | 'image/png'; base64: string }

/** Only the selected cache copy is read and removed, never the user's original. */
export async function pickMealPhoto(): Promise<MealPhoto | null> {
  const result = await getDocumentAsync({ type: ['image/jpeg', 'image/png'], multiple: false, copyToCacheDirectory: true });
  if (result.canceled) return null;
  const asset = result.assets[0], file = new File(asset.uri), cache = Paths.cache.uri;
  const cached = asset.uri.startsWith(cache + (cache.endsWith('/') ? '' : '/'));
  try {
    if (!cached || !file.exists || file.size <= 0 || file.size > 2 * 1024 * 1024 || !['image/jpeg', 'image/png'].includes(asset.mimeType ?? '')) throw new Error('Choose a JPEG or PNG meal photo up to 2 MiB.');
    const base64 = await file.base64();
    if (base64.length > 2_796_204) throw new Error('Choose a photo up to 2 MiB.');
    return { mimeType: asset.mimeType as MealPhoto['mimeType'], base64 };
  } finally { if (cached && file.exists) file.delete(); }
}
