import * as Picker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File, Paths } from 'expo-file-system';
import type { VehiclePhoto } from '../../../../packages/shared/src/vehicle-checks.mjs';

function removeCache(uri:string) {
  if (!uri.startsWith(Paths.cache.uri)) return;
  try { const file=new File(uri);if(file.exists)file.delete(); } catch { /* OS cache reclamation is the fallback. */ }
}
export async function chooseVehiclePhoto(camera:boolean):Promise<VehiclePhoto|null> {
  if(camera && !(await Picker.requestCameraPermissionsAsync()).granted) throw new Error('Camera access is off. Enable it in phone settings, or choose a photo.');
  const options:Picker.ImagePickerOptions={mediaTypes:['images'],allowsEditing:false,quality:0.9,exif:false,base64:false};
  const result=camera ? await Picker.launchCameraAsync(options) : await Picker.launchImageLibraryAsync(options);
  if(result.canceled)return null;
  const asset=result.assets[0];let output:string|undefined;
  const context=ImageManipulator.manipulate(asset.uri);
  let rendered:Awaited<ReturnType<typeof context.renderAsync>>|undefined;
  try {
    if(!asset.width || !asset.height || asset.width*asset.height>32_000_000 || (asset.fileSize??0)>20*1024*1024)throw new Error('Choose a smaller, clear vehicle photo.');
    const scale=Math.min(1,1600/Math.max(asset.width,asset.height));
    context.resize({width:Math.round(asset.width*scale),height:Math.round(asset.height*scale)});
    rendered=await context.renderAsync();
    const photo=await rendered.saveAsync({format:SaveFormat.JPEG,compress:0.9,base64:true});output=photo.uri;
    if(!photo.base64 || photo.base64.length>Math.ceil(2*1024*1024/3)*4)throw new Error('Photo is too large. Take a closer picture of the vehicle and plate.');
    return {mimeType:'image/jpeg',base64:photo.base64};
  } finally { if(output)removeCache(output);removeCache(asset.uri);rendered?.release();context.release(); }
}
