import assert from 'node:assert/strict';
import { DEFAULT_STATE, categoryLabel } from '../src/data.js';
import { suggestCategoryId } from '../src/categoryHelpers.js';
import {
  createSupplierRowsFromText,
  createImportItemsFromRows,
  parseCsv,
  parseImportQuantity,
  pickColumn,
} from '../src/supplierImport.js';

const rows = parseCsv('Description,Qty Ordered,Product URL\n"Motor, NEMA 17","2 pcs",https://example.test/motor\n"Sensor ""A""",1,\n');
assert.deepEqual(rows[0], ['Description', 'Qty Ordered', 'Product URL']);
assert.deepEqual(rows[1], ['Motor, NEMA 17', '2 pcs', 'https://example.test/motor']);
assert.deepEqual(rows[2], ['Sensor "A"', '1', '']);

const quantityColumn = pickColumn(rows[0], ['quantity', 'qty', 'orderquantity', 'orderedquantity', 'qtyordered', 'itemquantity']);
assert.equal(quantityColumn, 1);
assert.equal(parseImportQuantity(rows[1][quantityColumn]), 2);
assert.equal(parseImportQuantity('1,250 units'), 1250);
assert.equal(parseImportQuantity(''), 1);

const supplierRows = createSupplierRowsFromText(`
  296-6501-1-ND 2 EA NE555P Timer IC
  Manufacturer Texas Instruments
  296-6501-1-ND Duplicate line should be ignored
  732-4989-ND 10 EA Terminal Block
`);
assert.deepEqual(supplierRows[0], ['sku', 'description']);
assert.equal(supplierRows.length, 3);
assert.equal(supplierRows[1][0], '296-6501-1-ND');
assert.match(supplierRows[1][1], /NE555P Timer IC/);
assert.equal(supplierRows[2][0], '732-4989-ND');

const motorCategoryId = suggestCategoryId('DRV8833 motor driver module', DEFAULT_STATE.categories);
assert.equal(categoryLabel(DEFAULT_STATE.categories, motorCategoryId), 'Motors & Motion');

const customCategories = [
  { id: 'cat-unassigned', name: 'Unassigned', parentId: null, sortOrder: 0 },
  { id: 'custom-modules', name: 'Modules', parentId: null, sortOrder: 1 },
  { id: 'custom-motors', name: 'Motors & Motion', parentId: null, sortOrder: 2 },
];
assert.equal(suggestCategoryId('N20 gearmotor module', customCategories), 'custom-motors');

const renamedDefaultCategories = [
  { id: 'cat-unassigned', name: 'Unassigned', parentId: null, sortOrder: 0 },
  { id: 'cat-web-5', name: 'Modules', parentId: null, sortOrder: 1 },
  { id: 'live-motors', name: 'Motors & Motion', parentId: null, sortOrder: 2 },
];
assert.equal(suggestCategoryId('servo motor controller module', renamedDefaultCategories), 'live-motors');

const commonSuggestions = [
  ['ESP32 development board', 'Microcontrollers & Development Boards / ESP32'],
  ['WS2812 addressable LED strip', 'Circuit Board Parts / LEDs / LED Strings'],
  ['NE555 timer IC', "Circuit Board Parts / IC's"],
  ['Schottky diode', 'Circuit Board Parts / Diodes'],
  ['MOSFET breakout module', 'Circuit Board Parts'],
  ['JST connector cable', 'Connectors & Wiring'],
  ['18650 battery holder', 'Power / Battery'],
  ['M3 socket head screw', 'Mechanical & Hardware / Nuts, Bolts & Screws / Screws'],
];
commonSuggestions.forEach(([name, expectedCategory]) => {
  assert.equal(categoryLabel(DEFAULT_STATE.categories, suggestCategoryId(name, DEFAULT_STATE.categories)), expectedCategory);
});

const importItems = createImportItemsFromRows(parseCsv('Description\n"Motor Driver Module"\n'), [], customCategories);
assert.equal(importItems[0].categoryId, 'custom-motors');

console.log('Supplier import smoke check passed.');
