import { getDocumentAsync } from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Picker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
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

function removeCameraCache(uri: string) {
  const cache = Paths.cache.uri.endsWith('/') ? Paths.cache.uri : Paths.cache.uri + '/';
  if (!uri.startsWith(cache)) return;
  try { const file = new File(uri); if (file.exists) file.delete(); } catch { /* OS cache cleanup is the fallback. */ }
}

/** Capture is optional and does not establish liveness. Resize without cropping either portrait. */
export async function captureDriverFile(kind: 'profile_photo' | 'driving_licence'): Promise<DriverFile | null> {
  if (!(await Picker.requestCameraPermissionsAsync()).granted) throw new Error('Camera access is off. Enable it in phone settings, or choose an image from this device.');
  const result = await Picker.launchCameraAsync({ mediaTypes: ['images'], cameraType: kind === 'profile_photo' ? Picker.CameraType.front : Picker.CameraType.back,
    allowsEditing: false, quality: 0.9, exif: false, base64: false });
  if (result.canceled) return null;
  const asset = result.assets[0];
  const context = ImageManipulator.manipulate(asset.uri);
  let rendered: Awaited<ReturnType<typeof context.renderAsync>> | undefined, output: string | undefined;
  try {
    if (!asset.width || !asset.height || asset.width * asset.height > 32_000_000 || (asset.fileSize ?? 0) > 20 * 1024 * 1024) throw new Error('Take a smaller, clear photo of your face or licence.');
    const scale = Math.min(1, 1600 / Math.max(asset.width, asset.height));
    context.resize({ width: Math.round(asset.width * scale), height: Math.round(asset.height * scale) });
    rendered = await context.renderAsync();
    const photo = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.9, base64: false }); output = photo.uri;
    return await readDriverFile({ uri: photo.uri, name: kind === 'profile_photo' ? 'driver-selfie.jpg' : 'licence-front.jpg', mimeType: 'image/jpeg' }, new File(photo.uri), Paths.cache.uri);
  } finally {
    if (output) removeCameraCache(output);
    removeCameraCache(asset.uri); rendered?.release(); context.release();
  }
}
