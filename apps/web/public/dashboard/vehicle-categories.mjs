import { VEHICLE_CATEGORIES, vehicleCategory } from '/shared/vehicle-categories.mjs';
import { element } from './dom.mjs';

/** Accessible category browsing. The caller owns navigation and booking visibility. */
export function createVehicleCategoryPicker(container, { onSelect = () => {} } = {}) {
  let selected = VEHICLE_CATEGORIES[0], disabled = false, allowed = null;
  const group = element('div', undefined, 'vehicle-category-grid');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'Explore vehicle categories');
  const description = element('p', undefined, 'vehicle-category-description');
  description.setAttribute('role', 'status');
  description.setAttribute('aria-atomic', 'true');
  const buttons = VEHICLE_CATEGORIES.map((category, index) => {
    const button = element('button', undefined, 'vehicle-category');
    button.type = 'button'; button.dataset.category = category.id;
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-label', `${category.name}, ${category.purpose}, ${category.statusLabel}`);
    const image = element('img'); image.src = category.assetPath; image.alt = '';
    image.width = 768; image.height = 512; image.decoding = 'async';
    button.append(image, element('strong', category.name), element('span', category.purpose, 'vehicle-category-purpose'),
      element('span', category.statusLabel, 'vehicle-category-status'));
    button.addEventListener('click', () => select(category.id));
    button.addEventListener('keydown', (event) => {
      const visible = VEHICLE_CATEGORIES.filter((item) => !allowed || allowed.includes(item.id)), index = visible.findIndex((item) => item.id === category.id), n = visible.length;
      const next = { ArrowRight: (index + 1) % n, ArrowDown: (index + 1) % n,
        ArrowLeft: (index + n - 1) % n, ArrowUp: (index + n - 1) % n, Home: 0, End: n - 1 }[event.key];
      if (next !== undefined) { event.preventDefault(); select(visible[next].id, true); }
    });
    group.append(button); return button;
  });
  function render() {
    buttons.forEach((button, index) => {
      const checked = VEHICLE_CATEGORIES[index].id === selected.id;
      button.setAttribute('aria-checked', String(checked));
      if (VEHICLE_CATEGORIES[index].id === 'standard') {
        button.children[1].textContent = allowed ? 'Car' : 'Standard';
        button.children[2].textContent = allowed ? 'Small parcel deliveries' : VEHICLE_CATEGORIES[index].purpose;
        button.children[3].textContent = allowed ? 'Delivery preview' : VEHICLE_CATEGORIES[index].statusLabel;
        button.setAttribute('aria-label', allowed ? 'Car, small parcel deliveries' : 'Standard, everyday car rides');
      }
      button.hidden = Boolean(allowed && !allowed.includes(VEHICLE_CATEGORIES[index].id));
      button.tabIndex = checked ? 0 : -1; button.disabled = disabled;
    });
    description.textContent = allowed && selected.id === 'standard' ? 'Car · Small parcel delivery. Confirm the load fits with your driver before collection.' : `${selected.name} · ${selected.statusLabel}. ${selected.description}`;
  }
  function select(id, focus = false) {
    const category = vehicleCategory(id);
    if (disabled || !category || (allowed && !allowed.includes(id))) return;
    selected = category; render(); onSelect(category);
    if (focus) buttons[VEHICLE_CATEGORIES.indexOf(category)].focus();
  }
  container.replaceChildren(group, description); render();
  return Object.freeze({ selected: () => selected, select,
    allow(ids) { allowed = ids; render(); },
    setDisabled(value) { disabled = Boolean(value); buttons.forEach((button) => { button.disabled = disabled; }); },
    reset() { disabled = false; allowed = null; selected = VEHICLE_CATEGORIES[0]; render(); onSelect(selected); },
  });
}
