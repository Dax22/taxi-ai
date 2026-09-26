import { useEffect, useState } from 'react';
import { Image, Text, View } from 'react-native';
import { useSession } from '../session/provider';
import { colors, styles } from './components';

export function DriverAvatar({ rideId, name }: { rideId: string; name: string }) {
  const { client } = useSession();
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    setUri(null);
    void client.driverPhoto(rideId).then((photo) => {
      if (current) setUri(`data:${photo.mimeType};base64,${photo.base64}`);
    }).catch(() => {
      if (current) setUri(null);
    });
    return () => { current = false; };
  }, [client, rideId]);
  if (uri) return <Image source={{ uri }} accessibilityLabel={`${name} driver profile photo`}
    style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: colors.border }} resizeMode="cover"/>;
  const initials = name.trim().split(/\s+/).slice(0,2).map((part) => part[0]?.toUpperCase()).join('') || 'DR';
  return <View accessibilityLabel="Driver profile photo unavailable" style={{ width:72,height:72,borderRadius:36,
    backgroundColor:colors.border,alignItems:'center',justifyContent:'center' }}><Text style={styles.h2}>{initials}</Text></View>;
}
