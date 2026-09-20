import type { PropsWithChildren } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

export const colors = { ink: '#171a18', muted: '#606762', paper: '#f6f6f2', white: '#ffffff', yellow: '#F4B400', border: '#dfe3dc' };
export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper }, content: { padding: 24, paddingBottom: 40, width: '100%', maxWidth: 900, alignSelf: 'center', gap: 20 },
  title: { fontSize: 34, fontWeight: '700', color: colors.ink, letterSpacing: -1.1 }, subtitle: { fontSize: 17, lineHeight: 25, color: colors.muted },
  h2: { fontSize: 23, fontWeight: '700', color: colors.ink }, body: { fontSize: 16, lineHeight: 24, color: colors.ink },
  small: { fontSize: 13, lineHeight: 20, color: colors.muted }, label: { fontSize: 13, fontWeight: '700', color: colors.muted, letterSpacing: 1 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 }, stack: { gap: 14 },
  card: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, borderRadius: 24, padding: 22, gap: 12 },
  button: { backgroundColor: colors.yellow, paddingVertical: 15, paddingHorizontal: 20, minHeight: 50, maxWidth: '100%', borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  secondary: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border }, buttonText: { fontSize: 16, fontWeight: '700', color: colors.ink, textAlign: 'center' },
  input: { backgroundColor: colors.white, borderColor: '#a9b3ab', borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 17, minHeight: 52, color: colors.ink },
  error: { backgroundColor: '#fff0eb', padding: 16, borderRadius: 14 }, errorText: { color: '#872c15', fontSize: 15, lineHeight: 22 },
  pill: { alignSelf: 'flex-start', borderRadius: 20, paddingVertical: 5, paddingHorizontal: 10, backgroundColor: '#fff0bd' },
});
export function Screen({ children }: PropsWithChildren) { return <SafeAreaView style={styles.screen} edges={['top','left','right','bottom']}><KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.content}>{children}</ScrollView></KeyboardAvoidingView></SafeAreaView>; }
export function Logo() { return <View style={styles.row}><Svg width={40} height={32} viewBox="0 0 320 240" accessibilityElementsHidden><Path fill={colors.yellow} d="M78 1h72c12 0 20 4 30 11l120 78c22 14 25 30 10 47l-88 88c-8 9-18 14-32 14h-49c-6 0-7-3-3-9 29-48 73-82 132-111 22-11 23-17 1-25-31-11-92-16-148-20-21-2-33-8-44-23L38 15C31 6 36 1 45 1Z M9 239h48c8 0 12-3 18-10 46-57 94-89 161-118 18-8 18-14-1-15-40-2-95 10-136 26-19 8-31 18-45 34L4 222c-8 10-4 17 5 17Z"/></Svg><Text style={styles.h2}>Taxi Ai</Text></View>; }
export function Heading({ title, subtitle }: { title: string; subtitle?: string }) { return <View style={styles.stack}><Text accessibilityRole="header" style={styles.title}>{title}</Text>{subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}</View>; }
export function Card({ children }: PropsWithChildren) { return <View style={styles.card}>{children}</View>; }
export function Button({ title, onPress, disabled = false, secondary = false, busy = false }: { title: string; onPress(): void; disabled?: boolean; secondary?: boolean; busy?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: disabled || busy, busy }} disabled={disabled || busy} onPress={onPress}
    style={({ pressed }) => [styles.button, secondary && styles.secondary, { opacity: disabled || busy ? 0.55 : pressed ? 0.75 : 1 }]}>{busy ? <ActivityIndicator color={colors.ink}/> : <Text style={styles.buttonText}>{title}</Text>}</Pressable>;
}
export function Field({ label, ...props }: TextInputProps & { label: string }) { return <View style={{ gap: 8 }}><Text style={styles.body}>{label}</Text><TextInput {...props} accessibilityLabel={label} style={styles.input} placeholderTextColor={colors.muted}/></View>; }
export function Notice({ message }: { message?: string }) { return message ? <View style={styles.error} accessibilityRole="alert"><Text style={styles.errorText}>{message}</Text></View> : null; }
export function Loading() { return <ActivityIndicator size="large" color={colors.ink} accessibilityLabel="Loading"/>; }
export function Pill({ children }: { children: string }) { return <View style={styles.pill}><Text style={styles.label}>{children}</Text></View>; }
export const readable = (value: string) => value.replaceAll('_',' ');
export const fare = (kobo: number) => `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export async function openWebsite(origin: string, path = '/app') { await Linking.openURL(origin + path); }
