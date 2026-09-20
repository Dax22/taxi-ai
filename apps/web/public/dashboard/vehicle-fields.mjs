import { $, element } from './dom.mjs';
import { VEHICLE_MAKES, VEHICLE_COLOURS, modelsForMake } from '/shared/vehicle-profile.mjs';
import { OTHER_VEHICLE_CHOICE, vehicleChoice, vehicleRegistrationYears, isVehicleRegistrationYear, vehicleYearMessage } from '/shared/vehicle-registration.mjs';

/** Dropdown state is separate from persisted details; custom values never become asset URLs. */
export function createVehicleFields({ onChange, prefix = 'onboarding' }) {
  const input = (name) => $(`${prefix}-${name}`);
  let disabled = false;
  function options(name, choices, placeholder, other = false) {
    const items = [['', placeholder], ...choices.map((value) => [value, value]), ...(other ? [[OTHER_VEHICLE_CHOICE, 'Other / not listed']] : [])];
    input(name).replaceChildren(...items.map(([value, label]) => {
      const option = element('option', label); option.value = value; return option;
    }));
    input(name).value = '';
  }
  function value(name) { return input(name).value === OTHER_VEHICLE_CHOICE ? input(`${name}-other`).value : input(name).value; }
  function setChoice(name, text, choices) {
    input(name).value = vehicleChoice(text, choices);
    input(`${name}-other`).value = input(name).value === OTHER_VEHICLE_CHOICE ? text : '';
  }
  function update() {
    for (const name of ['make', 'model', 'colour']) {
      const other = input(name).value === OTHER_VEHICLE_CHOICE;
      input(`${name}-other-row`).hidden = !other;
      input(`${name}-other`).disabled = disabled || !other;
      input(`${name}-other`).required = other;
      input(name).disabled = disabled || (name === 'model' && !value('make').trim());
    }
    input('year').disabled = disabled;
    const year = input('year').value;
    input('year').setCustomValidity(year && !isVehicleRegistrationYear(Number(year)) ? vehicleYearMessage() : '');
    input('year-hint').textContent = vehicleYearMessage();
  }
  function load(vehicle = {}) {
    options('make', Object.keys(VEHICLE_MAKES), 'Select make', true);
    options('colour', VEHICLE_COLOURS.map((c) => c.name), 'Select colour', true);
    setChoice('make', vehicle.make ?? '', Object.keys(VEHICLE_MAKES));
    const models = modelsForMake(vehicle.make ?? '');
    options('model', models, vehicle.make ? 'Select model' : 'Select make first', true);
    setChoice('model', vehicle.model ?? '', models);
    setChoice('colour', vehicle.colour ?? '', VEHICLE_COLOURS.map((c) => c.name));
    const years = vehicleRegistrationYears().map(String), year = vehicle.year == null ? '' : String(vehicle.year);
    options('year', years, 'Select year');
    if (year && !years.includes(year)) {
      const previous = element('option', `${year} — choose a year from 2000`);
      previous.value = year; previous.disabled = true; input('year').append(previous);
    }
    input('year').value = year;
    update();
  }
  function makeChanged() {
    // Explicit make edits clear the old model, including unlisted models.
    options('model', modelsForMake(value('make')), value('make').trim() ? 'Select model' : 'Select make first', true);
    input('model-other').value = '';
  }
  for (const name of ['make', 'model', 'colour']) {
    input(name).addEventListener('change', () => {
      input(`${name}-other`).value = '';
      if (name === 'make') makeChanged();
      update(); onChange();
    });
    input(`${name}-other`).addEventListener('input', () => {
      if (name === 'make') makeChanged();
      update(); onChange();
    });
  }
  input('year').addEventListener('change', () => { update(); onChange(); });
  load();
  return Object.freeze({ load, values: () => Object.fromEntries(['make', 'model', 'year', 'colour'].map((name) => [name, value(name)])),
    setDisabled(next) { disabled = next; update(); } });
}
