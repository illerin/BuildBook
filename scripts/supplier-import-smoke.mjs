import assert from 'node:assert/strict';
import {
  createSupplierRowsFromText,
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

console.log('Supplier import smoke check passed.');
