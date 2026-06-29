import { makeId } from './data.js';

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (quoted && char === '"' && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === ',') {
      row.push(cell);
      cell = '';
    } else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

export function pickColumn(headers, names) {
  const normalized = headers.map((header) => header.toLowerCase().replace(/[^a-z0-9]/g, ''));
  return names.map((name) => normalized.indexOf(name)).find((index) => index >= 0) ?? -1;
}

export function parseImportQuantity(value) {
  const match = String(value || '').replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  if (!match) return 1;
  return Math.max(1, Math.round(Number(match[0]) || 1));
}

function decodePdfString(value) {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\\t/g, ' ')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\');
}

export async function extractBasicPdfText(file) {
  const buffer = await file.arrayBuffer();
  const raw = new TextDecoder('latin1').decode(new Uint8Array(buffer));
  const matches = [...raw.matchAll(/\((?:\\.|[^\\)])*\)/g)]
    .map((match) => decodePdfString(match[0].slice(1, -1)).trim())
    .filter((value) => value && /[a-z0-9]/i.test(value));
  return matches.join('\n').replace(/\n{3,}/g, '\n\n');
}

export function createSupplierRowsFromText(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const rows = [['sku', 'description']];
  const seen = new Set();

  lines.forEach((line, index) => {
    const skuMatch = line.match(/\b[A-Z0-9][A-Z0-9-]{2,}-ND\b/i);
    if (!skuMatch) return;
    const sku = skuMatch[0].toUpperCase();
    if (seen.has(sku)) return;
    seen.add(sku);
    const context = [line, lines[index + 1], lines[index + 2]]
      .filter(Boolean)
      .join(' ')
      .replace(sku, '')
      .replace(/\b\d+\s+EA\b/i, '')
      .trim();
    rows.push([sku, context || sku]);
  });

  return rows.length > 1 ? rows : [];
}

function categoryPathForSuggestion(categories, categoryId) {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const path = [];
  let current = byId.get(categoryId);
  while (current) {
    path.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : null;
  }
  return path;
}

function suggestSupplierCategoryId(name, categories) {
  const text = String(name || '').toLowerCase();
  const coolingCategory = categories.find((category) => category.name.trim().toLowerCase() === 'cooling');
  if (['fan', 'blower'].some((term) => text.includes(term))) {
    const fanCategories = categories.filter((category) => /\bfans?\b/i.test(category.name));
    const coolingFanCategory = fanCategories.find((category) => categoryPathForSuggestion(categories, category.id).some((part) => part.toLowerCase() === 'cooling'));
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

export function createImportItemsFromRows(rows, parts, categories) {
  if (!rows.length) return [];
  const headers = rows[0].map((header) => header.trim());
  const nameIndex = pickColumn(headers, ['name', 'title', 'description', 'productdescription', 'manufacturerpartnumber', 'partnumber']);
  const urlIndex = pickColumn(headers, ['url', 'producturl', 'productpageurl', 'productpage', 'link', 'productlink', 'itemurl']);
  const imageIndex = pickColumn(headers, ['image', 'imageurl', 'productimage', 'productimageurl', 'mainimage', 'mainimageurl', 'picture', 'thumbnail', 'thumbnailurl', 'imagelink', 'photourl']);
  const skuIndex = pickColumn(headers, ['sku', 'digikeypartnumber', 'supplierpartnumber']);
  const quantityIndex = pickColumn(headers, ['quantity', 'qty', 'orderquantity', 'orderedquantity', 'qtyordered', 'itemquantity']);
  const rowsToUse = nameIndex >= 0 ? rows.slice(1) : rows;

  return rowsToUse.map((row) => {
    const fallbackName = row.find((value) => value?.trim()) || 'Imported Part';
    const name = (nameIndex >= 0 ? row[nameIndex] : fallbackName)?.trim() || 'Imported Part';
    const productUrl = (urlIndex >= 0 ? row[urlIndex] : '')?.trim() || '';
    const exactMatch = productUrl
      ? parts.find((part) => part.productUrl && part.productUrl === productUrl)
      : parts.find((part) => part.name.toLowerCase() === name.toLowerCase());
    const nameMatch = !exactMatch ? parts.find((part) => part.name.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(part.name.toLowerCase())) : null;

    return {
      id: makeId('import-item'),
      name,
      productUrl,
      imageUrl: (imageIndex >= 0 ? row[imageIndex] : '')?.trim() || '',
      sku: (skuIndex >= 0 ? row[skuIndex] : '')?.trim() || '',
      quantity: quantityIndex >= 0 ? parseImportQuantity(row[quantityIndex]) : 1,
      categoryId: suggestSupplierCategoryId(name, categories),
      status: 'draft',
      action: exactMatch || nameMatch ? 'merge' : 'create',
      matchId: (exactMatch || nameMatch)?.id || '',
      matchQuality: exactMatch ? 'exact' : nameMatch ? 'recommended' : 'none',
      raw: row,
    };
  });
}
