import { ActivityIndicator, Image, Platform, Pressable, View } from 'react-native';
import webImage from '../assets/google-sign-in.png';
import iosImage from '../assets/google-sign-in-ios.png';

/** Unmodified official branding assets; preserve their original aspect ratio. */
export function GoogleButton({ onPress, busy, disabled }: { onPress(): void; busy: boolean; disabled: boolean }) {
  const ios = Platform.OS === 'ios';
  return <Pressable accessibilityRole="button" accessibilityLabel="Sign in with Google" accessibilityState={{ disabled: disabled || busy, busy }}
    disabled={disabled || busy} onPress={onPress} style={{ minHeight: 53, alignItems: 'center', justifyContent: 'center', opacity: disabled || busy ? .55 : 1 }}>
    <View style={{ maxWidth: '100%', width: ios ? 225.6 : 216, aspectRatio: ios ? 188 / 44 : 180 / 40 }}>
      <Image source={ios ? iosImage : webImage} resizeMode="contain" style={{ width: '100%', height: '100%' }} accessible={false}/>
    </View>{busy && <ActivityIndicator accessibilityLabel="Opening Google"/>}
  </Pressable>;
}
