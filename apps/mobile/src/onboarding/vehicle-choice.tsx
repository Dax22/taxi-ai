import { useState } from 'react';
import { OTHER_VEHICLE_CHOICE, vehicleChoice } from '../../../../packages/shared/src/vehicle-registration.mjs';
import { Field } from '../ui/components';
import { SelectField } from '../ui/select-field';

export function VehicleChoice({ label, value, choices, onChange, disabled, maxLength, customLabel = `Enter ${label.toLowerCase()}` }: {
  label: string; value: string; choices: readonly string[]; onChange(value: string): void; disabled: boolean; maxLength: number; customLabel?: string;
}) {
  const [custom, setCustom] = useState(false);
  const choice = vehicleChoice(value, choices) || (custom ? OTHER_VEHICLE_CHOICE : '');
  return <><SelectField label={label} value={choice} options={[...choices.map((name) => ({ value: name, label: name })), { value: OTHER_VEHICLE_CHOICE, label: 'Other / not listed' }]}
    placeholder={`Select ${label.toLowerCase()}`} disabled={disabled} onChange={(next) => { setCustom(next === OTHER_VEHICLE_CHOICE); onChange(next === OTHER_VEHICLE_CHOICE ? '' : next); }}/>
    {choice === OTHER_VEHICLE_CHOICE && <Field label={customLabel} value={value} onChangeText={onChange} maxLength={maxLength} editable={!disabled}/>}</>;
}
