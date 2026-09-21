import Svg, { Path } from 'react-native-svg';
import type { ColorValue } from 'react-native';
const paths = {
  home: 'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
  activity: 'M21 12a9 9 0 1 1-3-6.7M21 3v6h-6M12 7v5l3 2',
  work: 'M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 7h18v13H3ZM3 11l9 4 9-4M12 13v4',
  updates: 'M6 8a6 6 0 0 1 12 0v7l2 3H4l2-3ZM9 21h6',
  account: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2',
};
export function TabIcon({ name, color }: { name: keyof typeof paths; color: ColorValue }) {
  return <Svg width={23} height={23} viewBox="0 0 24 24" accessibilityElementsHidden><Path d={paths[name]} stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" fill="none"/></Svg>;
}
