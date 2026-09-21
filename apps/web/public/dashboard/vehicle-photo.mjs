/** User-selected local image only. Canvas re-encoding does not copy EXIF data. */
export async function readVehiclePhoto(file) {
  if (!file || !['image/jpeg','image/png'].includes(file.type) || file.size<=0 || file.size>20*1024*1024) throw new Error('Choose a JPEG or PNG vehicle photo up to 20 MiB.');
  const bitmap = await createImageBitmap(file,{imageOrientation:'from-image'});
  try {
    if (bitmap.width<160 || bitmap.height<120 || bitmap.width*bitmap.height>32_000_000) throw new Error('Use a clear vehicle photo at least 160 × 120 pixels, up to 32 megapixels.');
    const scale = Math.min(1,1600/Math.max(bitmap.width,bitmap.height)), preview = document.createElement('canvas');
    preview.width = Math.round(bitmap.width*scale); preview.height = Math.round(bitmap.height*scale);
    const context = preview.getContext('2d'); if (!context) throw new Error('Photo preview is unavailable in this browser.');
    context.fillStyle='#fff';context.fillRect(0,0,preview.width,preview.height);context.drawImage(bitmap,0,0,preview.width,preview.height);
    const base64 = preview.toDataURL('image/jpeg',0.9).split(',')[1];
    if (!base64 || base64.length>Math.ceil(2*1024*1024/3)*4) throw new Error('Take a smaller photo showing the vehicle and its number plate.');
    return {image:{mimeType:'image/jpeg',base64},preview};
  } finally { bitmap.close(); }
}
