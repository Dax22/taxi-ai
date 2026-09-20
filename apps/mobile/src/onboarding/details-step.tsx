import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { modelsForMake, VEHICLE_MAKES, VEHICLE_COLOURS } from '../../../../packages/shared/src/vehicle-profile.mjs';
import { Button, Card, Field, colors, styles } from '../ui/components';
import { VehicleCard } from '../ui/vehicle-card';
import type { DriverDraft } from './form';

function Suggestions({ values, onPick, disabled }: { values: readonly string[]; onPick(value: string): void; disabled: boolean }) {
  return values.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={form.choices}>
    {values.map((value) => <Pressable key={value} accessibilityRole="button" accessibilityLabel={`Choose ${value}`} accessibilityState={{ disabled }} disabled={disabled} onPress={() => onPick(value)} style={form.choice}><Text style={styles.body}>{value}</Text></Pressable>)}
  </ScrollView> : null;
}
export function DetailsStep({ draft, onChange, disabled, onSave, pending }: { draft: DriverDraft; onChange(value: DriverDraft): void; disabled: boolean; onSave(): void; pending: boolean }) {
  const set = (key: keyof DriverDraft, value: string) => onChange({ ...draft, [key]: value, ...(key === 'make' && value !== draft.make ? { model: '' } : {}) });
  return <><Card><Text style={styles.h2}>Tell us about you.</Text><Text style={styles.small}>Your contact number and licence stay private to your application.</Text>
    <Field label="Full legal name" value={draft.legalName} onChangeText={(v) => set('legalName',v)} maxLength={100} editable={!disabled} autoComplete="name"/>
    <Field label="Contact number" value={draft.phone} onChangeText={(v) => set('phone',v)} placeholder="+234…" keyboardType="phone-pad" maxLength={16} editable={!disabled}/>
    <Field label="Driving licence number" value={draft.licenceNumber} onChangeText={(v) => set('licenceNumber',v)} autoCapitalize="characters" maxLength={40} editable={!disabled}/>
  </Card><Card><Text style={styles.h2}>Make it recognisable.</Text><Text style={styles.small}>Choose a suggestion or enter the details on your vehicle documents. Suggestions do not determine eligibility.</Text>
    <Field label="Vehicle make" value={draft.make} onChangeText={(v) => set('make',v)} placeholder="e.g. Toyota" maxLength={40} editable={!disabled}/>
    <Suggestions values={Object.keys(VEHICLE_MAKES).filter((v) => v.toLowerCase().includes(draft.make.toLowerCase()))} onPick={(v) => set('make',v)} disabled={disabled}/>
    <Field label="Vehicle model" value={draft.model} onChangeText={(v) => set('model',v)} placeholder="e.g. Corolla" maxLength={80} editable={!disabled}/>
    <Suggestions values={modelsForMake(draft.make).filter((v) => v.toLowerCase().includes(draft.model.toLowerCase()))} onPick={(v) => set('model',v)} disabled={disabled}/>
    <Field label="Vehicle year" value={draft.year} onChangeText={(v) => set('year',v)} placeholder="e.g. 2020" keyboardType="number-pad" maxLength={4} editable={!disabled}/>
    <Text style={styles.body}>Vehicle colour</Text><View style={form.colours}>
      {VEHICLE_COLOURS.map((c) => <Pressable key={c.id} accessibilityRole="radio" accessibilityLabel={c.name} accessibilityState={{ checked: draft.colour.toLowerCase() === c.id, disabled }} disabled={disabled} onPress={() => set('colour',c.name)}
        style={[form.colour, draft.colour.toLowerCase() === c.id && form.selected]}><View style={[form.swatch,{ backgroundColor: c.hex }]}/><Text style={styles.small}>{draft.colour.toLowerCase() === c.id ? '✓ ' : ''}{c.name}</Text></Pressable>)}
    </View><Field label="Colour description" value={draft.colour} onChangeText={(v) => set('colour',v)} placeholder="Or describe another colour / two-tone paint" maxLength={30} editable={!disabled}/>
    <Field label="Number plate" value={draft.plate} onChangeText={(v) => set('plate',v.toUpperCase())} autoCapitalize="characters" autoCorrect={false} maxLength={15} editable={!disabled}/>
  </Card><VehicleCard vehicle={{ make: draft.make, model: draft.model, year: /^\d{4}$/.test(draft.year) ? Number(draft.year) : undefined, colour: draft.colour, plate: draft.plate }} label="YOUR VEHICLE PREVIEW"/>
    <Button title="Save details and continue" onPress={onSave} busy={pending} disabled={disabled}/></>;
}
const form = StyleSheet.create({ choices: { gap: 8, paddingVertical: 4 }, choice: { borderRadius: 20, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 15, paddingVertical: 10 },
  colours: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, colour: { padding: 9, minWidth: 78, minHeight: 72, alignItems: 'center', gap: 7, borderWidth: 2, borderColor: colors.border, borderRadius: 14 },
  selected: { borderColor: colors.ink, backgroundColor: '#FFF7DE' }, swatch: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: '#919994' } });
