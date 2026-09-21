import { VEHICLE_CATEGORIES, vehicleCategory } from '/shared/vehicle-categories.mjs';
import { element } from './dom.mjs';

/** Accessible category browsing. The caller owns navigation and booking visibility. */
export function createVehicleCategoryPicker(container, { onSelect = () => {} } = {}) {
  let selected = VEHICLE_CATEGORIES[0], disabled = false;
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
      const n = VEHICLE_CATEGORIES.length;
      const next = { ArrowRight: (index + 1) % n, ArrowDown: (index + 1) % n,
        ArrowLeft: (index + n - 1) % n, ArrowUp: (index + n - 1) % n, Home: 0, End: n - 1 }[event.key];
      if (next !== undefined) { event.preventDefault(); select(VEHICLE_CATEGORIES[next].id, true); }
    });
    group.append(button); return button;
  });
  function render() {
    buttons.forEach((button, index) => {
      const checked = VEHICLE_CATEGORIES[index].id === selected.id;
      button.setAttribute('aria-checked', String(checked));
      button.tabIndex = checked ? 0 : -1; button.disabled = disabled;
    });
    description.textContent = `${selected.name} · ${selected.statusLabel}. ${selected.description}`;
  }
  function select(id, focus = false) {
    const category = vehicleCategory(id);
    if (disabled || !category) return;
    selected = category; render(); onSelect(category);
    if (focus) buttons[VEHICLE_CATEGORIES.indexOf(category)].focus();
  }
  container.replaceChildren(group, description); render();
  return Object.freeze({ selected: () => selected, select,
    setDisabled(value) { disabled = Boolean(value); buttons.forEach((button) => { button.disabled = disabled; }); },
    reset() { disabled = false; selected = VEHICLE_CATEGORIES[0]; render(); onSelect(selected); },
  });
}
