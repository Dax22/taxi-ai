import { StyleSheet, Text as NativeText } from 'react-native';
import type { StyleProp, TextProps, TextStyle } from 'react-native';

export const fontFamily = 'Manrope_400Regular';
export const fontFamilyMedium = 'Manrope_500Medium';
export const fontFamilySemiBold = 'Manrope_600SemiBold';
export const fontFamilyBold = 'Manrope_700Bold';
export const fontFamilyExtraBold = 'Manrope_800ExtraBold';

/** Select the loaded Manrope face instead of asking a device to synthesize a weight. */
export function fontFamilyFor(style?: StyleProp<TextStyle>) {
  const weight = StyleSheet.flatten(style)?.fontWeight;
  const numeric = weight === 'bold' ? 700 : weight === 'normal' || weight === undefined ? 400 : Number(weight);
  if (numeric >= 800) return fontFamilyExtraBold;
  if (numeric >= 700) return fontFamilyBold;
  if (numeric >= 600) return fontFamilySemiBold;
  if (numeric >= 500) return fontFamilyMedium;
  return fontFamily;
}
export function Text({ style, ...props }: TextProps) {
  return <NativeText {...props} style={[style, { fontFamily: fontFamilyFor(style), fontWeight: 'normal' }]}/>;
}
