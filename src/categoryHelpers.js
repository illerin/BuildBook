import { categoryPath } from './compatibility.js';

function suggestionText(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function hasSuggestionTerm(text, term) {
  const cleanTerm = suggestionText(term);
  return cleanTerm ? ` ${text} `.includes(` ${cleanTerm} `) : false;
}

function suggestionTermScore(text, term) {
  const cleanTerm = suggestionText(term);
  if (!cleanTerm || !hasSuggestionTerm(text, cleanTerm)) return 0;
  const wordCount = cleanTerm.split(' ').filter(Boolean).length;
  return 80 + (wordCount * 18) + Math.min(cleanTerm.length, 28);
}

function bestSuggestionTermScore(text, terms) {
  return Math.max(0, ...terms.map((term) => suggestionTermScore(text, term)));
}

function bestCategoryTermScore(categoryText, categoryTerms, partText) {
  return Math.max(0, ...categoryTerms.map((term) => {
    const score = suggestionTermScore(categoryText, term);
    return score && hasSuggestionTerm(partText, term) ? score + 55 : score;
  }));
}

function categorySuggestionScore(category, categories, rule, partText) {
  const categoryTerms = rule.categoryTerms || [];
  const nameText = suggestionText(category.name);
  const pathText = suggestionText(categoryPath(categories, category.id).join(' '));
  const nameScore = bestCategoryTermScore(nameText, categoryTerms, partText);
  const pathScore = bestCategoryTermScore(pathText, categoryTerms, partText);
  const liveScore = Math.max(
    nameScore ? nameScore + 120 : 0,
    pathScore ? pathScore + 70 : 0,
  );
  return liveScore && category.id === rule.id ? liveScore + 5 : liveScore;
}

function findSuggestedCategory(categories, rule, partText) {
  const liveMatch = categories
    .filter((category) => category.id !== 'cat-unassigned')
    .map((category) => ({ category, score: categorySuggestionScore(category, categories, rule, partText) }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || (a.category.sortOrder ?? 0) - (b.category.sortOrder ?? 0))[0];
  if (liveMatch) return liveMatch.category.id;

  return categories.find((category) => category.id === rule.id)?.id || '';
}

const CATEGORY_SUGGESTION_RULES = [
  {
    id: 'cat-3c9d9111-0569-4a10-8fc8-470ded424aeb',
    terms: ['pcb', 'pcba', 'printed circuit board', 'circuit board', 'custom board'],
    categoryTerms: ['pcb', 'pcba', 'printed circuit', 'custom pcb'],
    weight: 30,
  },
  {
    id: 'cat-ac6da2e8-e4db-4c22-a1ac-dbe42f1b68d9',
    terms: ['esp32', 'esp8266'],
    categoryTerms: ['esp32', 'esp8266'],
    weight: 90,
  },
  {
    id: 'cat-3db2c34e-ee9d-43e9-bcd9-936fbb4c7f6c',
    terms: ['arduino'],
    categoryTerms: ['arduino'],
    weight: 90,
  },
  {
    id: 'cat-web-13',
    terms: ['raspberry', 'raspberry pi', 'pico', 'mcu', 'microcontroller', 'development board', 'dev board'],
    categoryTerms: ['microcontroller', 'microcontrollers', 'development board', 'development boards'],
    weight: 25,
  },
  {
    id: 'cat-web-2',
    terms: ['sensor', 'current sensor', 'temperature', 'humidity', 'imu', 'accelerometer', 'gyro', 'gyroscope', 'pressure', 'distance', 'tof', 'ultrasonic', 'hall sensor', 'limit sensor'],
    categoryTerms: ['sensor', 'sensors'],
    weight: 15,
  },
  {
    id: 'cat-a6de9175-7170-418e-9fff-3192b71089f7',
    terms: ['battery', 'batteries', 'battery holder', 'bms', 'lipo', 'li ion', '18650'],
    categoryTerms: ['battery', 'batteries'],
    weight: 25,
  },
  {
    id: 'cat-fc1396e8-bb2f-4cae-ba6f-4cec780ba629',
    terms: ['power supply', 'power adapter', 'charger', 'wall wart'],
    categoryTerms: ['power supply', 'power supplies', 'charger'],
    weight: 20,
  },
  {
    id: 'cat-54051390-3617-46a2-af17-90fa243a4451',
    terms: ['buck', 'boost', 'regulator', 'voltage regulator', 'power module', 'dc dc'],
    categoryTerms: ['power module', 'power modules', 'regulator'],
    weight: 20,
  },
  {
    id: 'cat-1257d198-70de-4bd2-add4-a8938cc0ef93',
    terms: ['constant current', 'current supply', 'led current', 'led driver'],
    categoryTerms: ['led current', 'current supply'],
    weight: 25,
  },
  {
    id: 'cat-web-14',
    terms: ['power', 'voltage', 'dc jack', 'fuse'],
    categoryTerms: ['power'],
    weight: 0,
  },
  {
    id: 'cat-web-10',
    terms: ['connector', 'terminal', 'terminal block', 'header', 'socket', 'plug', 'jack', 'usb', 'wire', 'wiring', 'cable', 'jst', 'dupont', 'xt60', 'barrel jack'],
    categoryTerms: ['connector', 'connectors', 'wiring', 'wire'],
    weight: 10,
  },
  {
    id: 'cat-281a2446-0b4c-4e29-b1f1-dbd2e099751e',
    terms: ['display', 'oled', 'lcd', 'screen', 'tft', 'e ink', 'e paper', 'led matrix'],
    categoryTerms: ['display', 'displays', 'screen', 'screens'],
    weight: 15,
  },
  {
    id: 'cat-fcd7a999-4a1c-43c1-8286-97e05e9d68ee',
    terms: ['neopixel', 'ws2812', 'addressable led', 'led strip', 'led string', 'led strand', 'pixel led'],
    categoryTerms: ['led string', 'led strings', 'led strip', 'led strips', 'addressable led', 'led', 'leds'],
    weight: 30,
  },
  {
    id: 'cat-web-7',
    terms: ['led', 'leds', 'light emitting diode'],
    categoryTerms: ['led', 'leds'],
    weight: 10,
  },
  {
    id: 'cat-2f679848-6122-4a15-9e23-ed078ad116c7',
    terms: ['ic', 'ics', 'chip', 'integrated circuit', 'op amp', 'opamp', 'logic ic', 'timer ic', 'ne555', '555 timer', 'microchip'],
    categoryTerms: ['ic', 'ics', 'integrated circuit', 'chip'],
    weight: 20,
  },
  {
    id: 'cat-ccf6892a-0f10-46d5-97c2-b14f79f58aa0',
    terms: ['diode', 'diodes', 'zener', 'schottky', 'rectifier', 'tvs diode'],
    categoryTerms: ['diode', 'diodes'],
    weight: 20,
  },
  {
    id: 'cat-web-6',
    terms: ['capacitor', 'capacitance', 'electrolytic capacitor', 'ceramic capacitor'],
    categoryTerms: ['capacitor', 'capacitors'],
    weight: 20,
  },
  {
    id: 'cat-web-1',
    terms: ['resistor', 'resistance', 'ohm', 'kohm', 'potentiometer', 'trimmer pot'],
    categoryTerms: ['resistor', 'resistors'],
    weight: 20,
  },
  {
    id: 'cat-606b7d9c-9708-4a94-a0e7-f7bd610ff299',
    terms: ['inductor', 'inductance', 'choke', 'coil'],
    categoryTerms: ['inductor', 'inductors'],
    weight: 20,
  },
  {
    id: 'cat-8fc83b9e-3e60-4a58-92db-38940d1801e6',
    terms: ['mosfet', 'transistor', 'bjt', 'fet', 'triac', 'scr', 'crystal', 'oscillator'],
    categoryTerms: ['transistor', 'transistors', 'semiconductor', 'semiconductors', 'circuit board', 'circuit board parts'],
    weight: 15,
  },
  {
    id: 'cat-web-3',
    terms: ['relay', 'switch', 'toggle switch', 'pushbutton', 'push button', 'limit switch', 'microswitch'],
    categoryTerms: ['relay', 'relays', 'switch', 'switches'],
    weight: 20,
  },
  {
    id: 'cat-web-5',
    terms: ['motor', 'motors', 'motorized', 'gearmotor', 'gear motor', 'servo', 'servomotor', 'stepper', 'nema', 'actuator', 'esc', 'h bridge', 'motor driver', 'motor controller', 'bearing', 'pulley', 'belt', 'shaft', 'gear'],
    categoryTerms: ['motor', 'motors', 'motion', 'servo', 'stepper', 'actuator', 'drive', 'drive components'],
    weight: 25,
  },
  {
    id: 'cat-web-9',
    terms: ['tool', 'prototype', 'breadboard', 'crimper', 'solder'],
    categoryTerms: ['tool', 'tools', 'prototyping', 'prototype'],
  },
  {
    id: 'cat-web-37',
    terms: ['screw', 'screws', 'm2 screw', 'm3 screw', 'm4 screw'],
    categoryTerms: ['screw', 'screws'],
    weight: 30,
  },
  {
    id: 'cat-web-36',
    terms: ['bolt', 'bolts', 'm2 bolt', 'm3 bolt', 'm4 bolt'],
    categoryTerms: ['bolt', 'bolts'],
    weight: 30,
  },
  {
    id: 'cat-web-35',
    terms: ['nut', 'nuts', 'm2 nut', 'm3 nut', 'm4 nut'],
    categoryTerms: ['nut', 'nuts'],
    weight: 30,
  },
  {
    id: 'cat-web-34',
    terms: ['standoff', 'spacer', 'washer', 'm2', 'm3', 'm4', 'hardware'],
    categoryTerms: ['hardware', 'standoff', 'spacer', 'washer'],
    weight: 20,
  },
  {
    id: 'cat-web-4',
    terms: ['enclosure', 'case', 'bracket', 'mount', 'mounting plate', 'panel'],
    categoryTerms: ['mechanical', 'enclosure', 'enclosures', 'case', 'bracket'],
    weight: 10,
  },
  {
    id: 'cat-83ddc78b-8aca-41de-9d86-c19c7c445b68',
    terms: ['magnet', 'magnets', 'neodymium'],
    categoryTerms: ['magnet', 'magnets'],
    weight: 15,
  },
  {
    id: 'cat-d93e885b-19ca-4b9e-9e48-7af0f9457ba1',
    terms: ['fan', 'blower', 'heatsink', 'heat sink', 'heat-sink', 'cooler', 'cooling'],
    categoryTerms: ['cooling', 'fan', 'fans', 'heatsink', 'heat sink'],
    weight: 20,
  },
  {
    id: 'cat-c4e3c424-ad01-4402-a6e4-03d5946ff05e',
    terms: ['speaker', 'buzzer', 'microphone', 'audio', 'sound', 'amplifier'],
    categoryTerms: ['sound', 'audio', 'speaker', 'buzzer'],
    weight: 15,
  },
  {
    id: 'cat-web-12',
    terms: ['lens', 'laser', 'mirror', 'prism', 'optics', 'optical'],
    categoryTerms: ['optics', 'optical', 'physics'],
    weight: 15,
  },
  {
    id: 'cat-web-11',
    terms: ['module', 'modules', 'breakout', 'breakout board', 'board'],
    categoryTerms: ['module', 'modules'],
    weight: -30,
  },
];

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
  const text = suggestionText(name);
  const coolingCategory = categories.find((category) => category.name.trim().toLowerCase() === 'cooling');
  if (['fan', 'blower'].some((term) => hasSuggestionTerm(text, term))) {
    const fanCategories = categories.filter((category) => /\bfans?\b/i.test(category.name));
    const coolingFanCategory = fanCategories.find((category) => categoryPath(categories, category.id).some((part) => part.toLowerCase() === 'cooling'));
    return coolingFanCategory?.id || fanCategories[0]?.id || coolingCategory?.id || 'cat-unassigned';
  }
  if (['heatsink', 'heat sink', 'heat-sink', 'cooler', 'cooling'].some((term) => hasSuggestionTerm(text, term))) {
    return coolingCategory?.id || 'cat-unassigned';
  }
  const hit = CATEGORY_SUGGESTION_RULES
    .map((rule) => ({ rule, score: bestSuggestionTermScore(text, rule.terms) + (rule.weight || 0) }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score)[0];
  return hit ? findSuggestedCategory(categories, hit.rule, text) || 'cat-unassigned' : 'cat-unassigned';
}

export function descendantCategoryIds(categories, categoryId) {
  const children = categories.filter((category) => category.parentId === categoryId);
  return children.flatMap((category) => [category.id, ...descendantCategoryIds(categories, category.id)]);
}
