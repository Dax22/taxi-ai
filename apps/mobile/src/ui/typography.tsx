import { Platform, Text as NativeText } from 'react-native';
import type { TextProps } from 'react-native';

/** One native system font family for all app text, inputs and navigation. */
export const fontFamily = Platform.select({ ios: 'System', android: 'sans-serif', default: 'system-ui' });
export function Text({ style, ...props }: TextProps) {
  return <NativeText {...props} style={[{ fontFamily }, style]}/>;
}
