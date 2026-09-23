import * as Location from 'expo-location';
import type { Position } from '../../../../packages/shared/src/mobile-journeys.mjs';
export async function currentPosition(ask: boolean, purpose: 'work' | 'kitchen' = 'work'): Promise<Position> {
  const permission=ask ? await Location.requestForegroundPermissionsAsync() : await Location.getForegroundPermissionsAsync();
  if(!permission.granted) throw new Error(purpose === 'kitchen'
    ? 'Allow location access in your phone settings, then choose Use my current location again.'
    : 'Location access is needed to match nearby jobs. Allow it in your phone settings, then choose Go online.');
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const fix=await Promise.race([Location.getCurrentPositionAsync({accuracy:Location.Accuracy.High}),new Promise<never>((_,reject)=>{
      timeout=setTimeout(()=>reject(new Error('A fresh location is unavailable. Move to an open area and try again.')),10_000);
    })]);
    if(fix.coords.accuracy===null||fix.coords.accuracy>200||fix.coords.accuracy<=0)throw new Error('Location is not accurate enough yet. Try again in an open area.');
    return{lat:fix.coords.latitude,lng:fix.coords.longitude,accuracy:fix.coords.accuracy,capturedAt:Math.round(fix.timestamp)};
  }finally{clearTimeout(timeout);}
}
