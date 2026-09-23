import { element } from '../dashboard/dom.mjs';
import { NIGERIAN_STATES, foodAreaId, resolveFoodArea } from '/shared/nigeria-areas.mjs';

/** Towns are entered by the person booking, never inferred from a capital city. */
export function createFoodLocationFields({ state, town, onChange = () => {} }) {
  state.replaceChildren();
  for (const item of [{ id: '', name: 'Choose a state or FCT' }, ...NIGERIAN_STATES]) {
    const option = element('option', item.name); option.value = item.id; state.append(option);
  }
  state.value = '';
  const value = () => { try { return foodAreaId(state.value, town.value); } catch { return ''; } };
  state.addEventListener('change', () => onChange(value()));
  town.addEventListener('input', () => onChange(value()));
  return Object.freeze({
    value,
    set(areaId) { const area = resolveFoodArea(areaId); state.value = area?.stateId ?? ''; town.value = area?.town ?? ''; },
    required(required) { state.required = town.required = required; },
  });
}
export function foodAreaLabel(areaId) { const area = resolveFoodArea(areaId); return area ? `${area.town}, ${area.stateName}` : 'Location unavailable'; }
