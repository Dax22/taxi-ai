import * as Picker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File, Paths } from 'expo-file-system';
import { canDeleteGeneratedPhoto } from './photo-cache';

export interface DishPhoto { mimeType: 'image/jpeg'; base64: string }

function clearGeneratedCache(uri: string, source: string) {
  if (!canDeleteGeneratedPhoto(uri, source, Paths.cache.uri)) return;
  try { const file = new File(uri); if (file.exists) file.delete(); } catch { /* The OS will reclaim temporary files. */ }
}

export async function chooseDishPhoto(camera: boolean): Promise<DishPhoto | null> {
  if (camera && !(await Picker.requestCameraPermissionsAsync()).granted)
    throw new Error('Camera access is off. Enable it in phone settings, or choose a photo.');
  const options: Picker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: false, quality: .9, exif: false, base64: false };
  const result = camera ? await Picker.launchCameraAsync(options) : await Picker.launchImageLibraryAsync(options);
  if (result.canceled) return null;
  const asset = result.assets[0]; let output: string | undefined;
  const context = ImageManipulator.manipulate(asset.uri);
  let rendered: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
  try {
    if (!asset.width || !asset.height || asset.width < 160 || asset.height < 120 || asset.width * asset.height > 32_000_000
      || (asset.fileSize ?? 0) > 20 * 1024 * 1024) throw new Error('Choose a clear image at least 160 × 120 pixels, up to 20 MiB.');
    const scale = Math.min(1, 1200 / Math.max(asset.width, asset.height));
    context.resize({ width: Math.round(asset.width * scale), height: Math.round(asset.height * scale) });
    rendered = await context.renderAsync();
    const photo = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: .82, base64: true }); output = photo.uri;
    if (!photo.base64 || photo.base64.length > Math.ceil(2 * 1024 * 1024 / 3) * 4)
      throw new Error('Choose a smaller image.');
    return { mimeType: 'image/jpeg', base64: photo.base64 };
  } finally { if (output) clearGeneratedCache(output, asset.uri); rendered?.release(); context.release(); }
}
