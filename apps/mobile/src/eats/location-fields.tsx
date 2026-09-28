import { useEffect, useState } from 'react';
import { NIGERIAN_STATES, foodAreaId, resolveFoodArea } from '../../../../packages/shared/src/nigeria-areas.mjs';
import { Field, styles } from '../ui/components';
import { SelectField } from '../ui/select-field';
import { Text } from '../ui/typography';

/** Keep unfinished input local; a valid state and town produce one canonical location. */
export function FoodLocationFields({ value, onChange, disabled = false, label = 'Location' }: {
  value: string; onChange(value: string): void; disabled?: boolean; label?: string;
}) {
  const initial = resolveFoodArea(value);
  const [stateId, setStateId] = useState(initial?.stateId ?? ''), [town, setTown] = useState(initial?.town ?? '');
  const [error, setError] = useState('');
  useEffect(() => {
    const saved = resolveFoodArea(value);
    if (!saved) return;
    let current = '';
    try { current = foodAreaId(stateId, town); } catch { /* An incomplete input has no location. */ }
    if (current !== value) { setStateId(saved.stateId); setTown(saved.town); setError(''); }
  }, [value]);
  const edit = (nextState: string, nextTown: string) => {
    setStateId(nextState); setTown(nextTown); setError('');
    try { onChange(foodAreaId(nextState, nextTown)); }
    catch (e) { onChange(''); if (nextState && nextTown.trim().length > 1) setError(e instanceof Error ? e.message : 'Enter a town or local area.'); }
  };
  return <>
    <SelectField label={`${label} · state or FCT`} value={stateId} onChange={(next) => { if (next !== stateId) edit(next, ''); }}
      disabled={disabled} placeholder="Choose a state or FCT" options={NIGERIAN_STATES.map((state) => ({ value: state.id, label: state.name }))}/>
    <Field label={`${label} · town or local area`} value={town} onChangeText={(next) => edit(stateId, next)}
      editable={!disabled && Boolean(stateId)} placeholder="For example: Ikeja or Port Harcourt" maxLength={80} autoCorrect={false}/>
    {!!error && <Text style={styles.small} accessibilityLiveRegion="polite">{error}</Text>}
  </>;
}

export function foodLocationLabel(id: string) {
  const place = resolveFoodArea(id);
  return place ? `${place.town}, ${place.stateName}` : 'Location not selected';
}
