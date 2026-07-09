import { makeId } from './data.js';
import { suggestCategoryId } from './categoryHelpers.js';

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
      categoryId: suggestCategoryId(name, categories),
      status: 'draft',
      action: exactMatch || nameMatch ? 'merge' : 'create',
      matchId: (exactMatch || nameMatch)?.id || '',
      matchQuality: exactMatch ? 'exact' : nameMatch ? 'recommended' : 'none',
      raw: row,
    };
  });
}
