import { getDocumentAsync } from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { readDriverFile } from './document-file';
import type { DriverFile } from './document-file';
export type { DriverFile } from './document-file';

/** Read only a user-selected image; remove the picker's cache copy, never the original. */
export async function pickDriverFile(): Promise<DriverFile | null> {
  const result = await getDocumentAsync({ type: ['image/png','image/jpeg'], multiple: false, copyToCacheDirectory: true });
  if (result.canceled) return null;
  const asset = result.assets[0];
  return readDriverFile(asset,new File(asset.uri),Paths.cache.uri);
}
