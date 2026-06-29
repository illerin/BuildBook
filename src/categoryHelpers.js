import { categoryPath } from './compatibility';

export function flattenCategoryOptions(categories) {
  const children = new Map();
  categories.forEach((category) => {
    const key = category.parentId || '';
    children.set(key, [...(children.get(key) || []), category]);
  });

  const sort = (items) => [...items].sort((a, b) => {
    const order = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    return order || a.name.localeCompare(b.name);
  });

  const walk = (parentId = '', depth = 0, path = []) => sort(children.get(parentId) || []).flatMap((category) => {
    const nextPath = [...path, category.name];
    return [
      { ...category, depth, label: `${'  '.repeat(depth)}${category.name}`, fullLabel: nextPath.join(' / ') },
      ...walk(category.id, depth + 1, nextPath),
    ];
  });

  return walk();
}

export function nestedCategoryLabel(category) {
  return category.depth ? `${'-'.repeat(category.depth)} ${category.name}` : category.name;
}

export function findCategoryByPath(categories, path) {
  const normalized = path.map((part) => part.toLowerCase());
  return categories.find((category) => categoryPath(categories, category.id).map((part) => part.toLowerCase()).join('|') === normalized.join('|'));
}

export function suggestCategoryId(name, categories) {
  const text = String(name || '').toLowerCase();
  const coolingCategory = categories.find((category) => category.name.trim().toLowerCase() === 'cooling');
  if (['fan', 'blower'].some((term) => text.includes(term))) {
    const fanCategories = categories.filter((category) => /\bfans?\b/i.test(category.name));
    const coolingFanCategory = fanCategories.find((category) => categoryPath(categories, category.id).some((part) => part.toLowerCase() === 'cooling'));
    return coolingFanCategory?.id || fanCategories[0]?.id || coolingCategory?.id || 'cat-unassigned';
  }
  if (['heatsink', 'heat sink', 'heat-sink', 'cooler', 'cooling'].some((term) => text.includes(term))) {
    return coolingCategory?.id || 'cat-unassigned';
  }
  const rules = [
    ['cat-ac6da2e8-e4db-4c22-a1ac-dbe42f1b68d9', ['esp32', 'esp8266']],
    ['cat-3db2c34e-ee9d-43e9-bcd9-936fbb4c7f6c', ['arduino']],
    ['cat-web-13', ['raspberry', 'mcu', 'development board']],
    ['cat-web-2', ['sensor', 'temperature', 'humidity', 'imu', 'accelerometer', 'gyro', 'pressure', 'distance']],
    ['cat-web-14', ['battery', 'charger', 'buck', 'boost', 'regulator', 'power', 'voltage', 'current', 'dc-dc']],
    ['cat-web-10', ['connector', 'terminal', 'header', 'socket', 'plug', 'jack', 'usb', 'wire']],
    ['cat-281a2446-0b4c-4e29-b1f1-dbd2e099751e', ['display', 'oled', 'lcd', 'screen', 'tft', 'led matrix']],
    ['cat-web-6', ['capacitor', 'capacitance']],
    ['cat-web-1', ['resistor', 'ohm']],
    ['cat-web-3', ['relay', 'switch']],
    ['cat-web-5', ['motor', 'servo', 'stepper', 'bearing', 'gear']],
    ['cat-web-9', ['tool', 'prototype', 'breadboard', 'crimper', 'solder']],
    ['cat-web-34', ['screw', 'bolt', 'nut', 'standoff', 'hardware']],
    ['cat-web-4', ['enclosure', 'case', 'bracket']],
    ['cat-web-11', ['module', 'board']],
  ];
  const hit = rules.find(([, terms]) => terms.some((term) => text.includes(term)));
  return categories.some((category) => category.id === hit?.[0]) ? hit[0] : 'cat-unassigned';
}

export function descendantCategoryIds(categories, categoryId) {
  const children = categories.filter((category) => category.parentId === categoryId);
  return children.flatMap((category) => [category.id, ...descendantCategoryIds(categories, category.id)]);
}
