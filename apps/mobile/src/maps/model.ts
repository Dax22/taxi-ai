export interface MapPoint { lat: number; lng: number }
export interface MapPin extends MapPoint { id: string; title: string; description?: string; stale?: boolean }
export interface Coordinate { latitude: number; longitude: number }
export interface Region extends Coordinate { latitudeDelta: number; longitudeDelta: number }

export function nativeMapPolicy(platform: string, androidConfigured: boolean, expoGo: boolean) {
  if (platform === 'ios') return { label: 'Apple Maps', provider: undefined, available: true } as const;
  if (platform === 'android') return { label: 'Google Maps', provider: 'google', available: androidConfigured || expoGo } as const;
  return { label: 'Map', provider: undefined, available: false } as const;
}
export function coordinate(point: MapPoint): Coordinate {
  if (!Number.isFinite(point.lat) || Math.abs(point.lat) > 85 || !Number.isFinite(point.lng) || Math.abs(point.lng) > 180)
    throw new Error('This map position is unavailable.');
  return { latitude: point.lat, longitude: point.lng };
}
/** Nigeria route bounds do not cross the date line. Padding keeps pins away from map edges. */
export function mapRegion(points: MapPoint[]): Region | null {
  if (!points.length) return null;
  const values = points.map(coordinate);
  const latitudes = values.map(p => p.latitude), longitudes = values.map(p => p.longitude);
  const south = Math.min(...latitudes), north = Math.max(...latitudes), west = Math.min(...longitudes), east = Math.max(...longitudes);
  return { latitude: (south + north) / 2, longitude: (west + east) / 2,
    latitudeDelta: Math.max(0.006, (north - south) * 1.4), longitudeDelta: Math.max(0.006, (east - west) * 1.4) };
}
