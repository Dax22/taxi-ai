import { VEHICLE_CATEGORIES } from '../../../../packages/shared/src/vehicle-categories.mjs';
import type { VehicleCategoryId } from '../../../../packages/shared/src/vehicle-categories.mjs';
import { transportCategory } from '../../../../packages/shared/src/transport-categories.mjs';
import { Text } from '../ui/typography';
import { modelsForMake, VEHICLE_MAKES, VEHICLE_COLOURS } from '../../../../packages/shared/src/vehicle-profile.mjs';
import { vehicleRegistrationYears, vehicleYearMessage } from '../../../../packages/shared/src/vehicle-registration.mjs';
import { Button, Card, Field, styles } from '../ui/components';
import { SelectField } from '../ui/select-field';
import { VehicleCard } from '../ui/vehicle-card';
import { VehicleChoice } from './vehicle-choice';
import type { DriverDraft } from './form';

export function DetailsStep({ draft, onChange, disabled, onSave, pending }: { draft: DriverDraft; onChange(value: DriverDraft): void; disabled: boolean; onSave(): void; pending: boolean }) {
  const set = (key: keyof DriverDraft, value: string) => onChange({ ...draft, [key]: value, ...(key === 'make' && value !== draft.make ? { model: '' } : {}) });
  const years = vehicleRegistrationYears().map(String);
  const yearOptions = years.map((year) => ({ value: year, label: year, disabled: false }));
  if (draft.year && !years.includes(draft.year)) yearOptions.unshift({ value: draft.year, label: `${draft.year} — choose a year from 2000`, disabled: true });
  return <><Card><Text style={styles.h2}>Tell us about you.</Text><Text style={styles.small}>Your contact number and licence stay private to your application.</Text>
    <Field label="Full legal name" value={draft.legalName} onChangeText={(v) => set('legalName',v)} maxLength={100} editable={!disabled} autoComplete="name"/>
    <Field label="Contact number" value={draft.phone} onChangeText={(v) => set('phone',v)} placeholder="+234…" keyboardType="phone-pad" maxLength={16} editable={!disabled}/>
    <Field label="Driving licence number" value={draft.licenceNumber} onChangeText={(v) => set('licenceNumber',v)} autoCapitalize="characters" maxLength={40} editable={!disabled}/>
  </Card><Card><Text style={styles.h2}>Make it recognisable.</Text><Text style={styles.small}>Choose the details on your vehicle documents. If your make, model or colour is missing, select Other. All vehicles need a document review.</Text>
    <SelectField label="Vehicle category" value={draft.category ?? 'standard'} options={VEHICLE_CATEGORIES.map((c) => ({ value: c.id, label: c.name }))} disabled={disabled} onChange={(v) => onChange({ ...draft, category: v as VehicleCategoryId, payloadKg: '' })}/>
    {transportCategory(draft.category)?.service === 'delivery' && <><Field label="Verified load capacity (kg)" value={draft.payloadKg ?? ''} onChangeText={(v) => set('payloadKg', v)} keyboardType="decimal-pad" editable={!disabled} maxLength={10}/><Text style={styles.small}>Preview limit: {transportCategory(draft.category)?.maxLoadKg} kg. Manual review must verify the actual vehicle capacity.</Text></>}
    <VehicleChoice label="Vehicle make" value={draft.make} choices={Object.keys(VEHICLE_MAKES)} onChange={(v) => set('make',v)} maxLength={40} disabled={disabled}/>
    <SelectField label="Vehicle year" value={draft.year} options={yearOptions} placeholder="Select year" onChange={(v) => set('year',v)} disabled={disabled}/>
    <Text style={styles.small}>{vehicleYearMessage()}</Text>
    <VehicleChoice key={draft.make} label="Vehicle model" value={draft.model} choices={modelsForMake(draft.make)} onChange={(v) => set('model',v)} maxLength={80} disabled={disabled || !draft.make.trim()}/>
    <VehicleChoice label="Vehicle colour" value={draft.colour} choices={VEHICLE_COLOURS.map((c) => c.name)} onChange={(v) => set('colour',v)} maxLength={30} disabled={disabled} customLabel="Describe the colour or two-tone paint"/>
    <Field label="Number plate" value={draft.plate} onChangeText={(v) => set('plate',v.toUpperCase())} autoCapitalize="characters" autoCorrect={false} maxLength={15} editable={!disabled}/>
  </Card><VehicleCard vehicle={{ category: draft.category, payloadKg: Number(draft.payloadKg) || null, make: draft.make, model: draft.model, year: /^\d{4}$/.test(draft.year) ? Number(draft.year) : undefined, colour: draft.colour, plate: draft.plate }} label="YOUR VEHICLE PREVIEW"/>
    <Button title="Save details and continue" onPress={onSave} busy={pending} disabled={disabled}/></>;
}
