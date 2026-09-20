import { useEffect, useState } from 'react';
import { AppState, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, colors, styles } from './components';

export interface SelectOption { value: string; label: string; disabled?: boolean }
/** Native dropdown opens a scrollable selection sheet, including at large text sizes. */
export function SelectField({ label, value, options, onChange, disabled = false, placeholder = 'Select…' }: {
  label: string; value: string; options: readonly SelectOption[]; onChange(value: string): void; disabled?: boolean; placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => { if (state !== 'active') setOpen(false); });
    return () => listener.remove();
  }, []);
  const selected = options.find((option) => option.value === value);
  return <View style={styles.stack}><Text style={styles.body}>{label}</Text>
    <Pressable accessibilityRole="combobox" accessibilityLabel={label} accessibilityValue={{ text: selected?.label ?? placeholder }}
      accessibilityState={{ expanded: open, disabled }} disabled={disabled} onPress={() => setOpen(true)}
      style={[styles.input, select.trigger, disabled && { opacity: 0.55 }]}>
      <Text style={[styles.body, select.value, !selected && { color: colors.muted }]}>{selected?.label ?? placeholder}</Text><Text accessible={false} style={styles.body}>⌄</Text>
    </Pressable>
    <Modal transparent visible={open && !disabled} animationType="slide" onRequestClose={() => setOpen(false)}>
      <SafeAreaView style={select.overlay}>
        <Pressable style={StyleSheet.absoluteFill} accessible={false} onPress={() => setOpen(false)}/>
        <View style={select.sheet} accessibilityViewIsModal onAccessibilityEscape={() => setOpen(false)}>
          <Text accessibilityRole="header" style={[styles.h2, select.heading]}>{label}</Text>
          <FlatList data={options} keyExtractor={(option) => option.value} extraData={value} keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => <Pressable accessibilityRole="radio" accessibilityLabel={item.label}
              accessibilityState={{ checked: item.value === value, disabled: Boolean(item.disabled) }} disabled={item.disabled}
              onPress={() => { onChange(item.value); setOpen(false); }}
              style={[select.option, item.value === value && select.chosen, item.disabled && { opacity: 0.5 }]}>
              <Text style={[styles.body, select.value]}>{item.label}</Text>{item.value === value && <Text accessible={false}>✓</Text>}
            </Pressable>}/>
          <View style={select.heading}><Button title="Close" secondary onPress={() => setOpen(false)}/></View>
        </View>
      </SafeAreaView>
    </Modal>
  </View>;
}
const select = StyleSheet.create({
  trigger: { flexDirection: 'row', alignItems: 'center', gap: 12 }, value: { flex: 1, flexShrink: 1 },
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { maxHeight: '85%', width: '100%', maxWidth: 640, alignSelf: 'center', backgroundColor: colors.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' },
  heading: { padding: 20 }, option: { minHeight: 56, paddingVertical: 16, paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderColor: colors.border },
  chosen: { backgroundColor: '#FFF3CB' },
});
