export const MODEL_TRIANGLE_LIMIT = 50000;

export function isValidTriangle(triangle) {
  return triangle.length === 3 && triangle.every((point) => point.length === 3 && point.every(Number.isFinite));
}

export function limitTriangles(triangles, limit) {
  if (triangles.length <= limit) return triangles;
  const stride = Math.ceil(triangles.length / limit);
  return triangles.filter((_, index) => index % stride === 0).slice(0, limit);
}

export function parseStl(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const view = new DataView(buffer);
  const headerText = new TextDecoder().decode(bytes.slice(0, Math.min(bytes.length, 512))).trimStart();

  if (headerText.startsWith('solid')) {
    const text = new TextDecoder().decode(bytes);
    const vertices = [...text.matchAll(/vertex\s+([-0-9.eE+]+)\s+([-0-9.eE+]+)\s+([-0-9.eE+]+)/g)]
      .map((match) => [Number(match[1]), Number(match[2]), Number(match[3])]);
    const triangles = [];
    for (let i = 0; i + 2 < vertices.length; i += 3) triangles.push([vertices[i], vertices[i + 1], vertices[i + 2]]);
    if (triangles.length) return triangles;
  }

  if (buffer.byteLength < 84) return [];
  const count = Math.min(view.getUint32(80, true), Math.floor((buffer.byteLength - 84) / 50));
  const triangles = [];
  let offset = 84;
  for (let i = 0; i < count && offset + 50 <= buffer.byteLength; i += 1) {
    offset += 12;
    const triangle = [
      [view.getFloat32(offset, true), view.getFloat32(offset + 4, true), view.getFloat32(offset + 8, true)],
      [view.getFloat32(offset + 12, true), view.getFloat32(offset + 16, true), view.getFloat32(offset + 20, true)],
      [view.getFloat32(offset + 24, true), view.getFloat32(offset + 28, true), view.getFloat32(offset + 32, true)],
    ];
    if (isValidTriangle(triangle)) triangles.push(triangle);
    offset += 38;
  }
  return triangles;
}

export function parseObj(text) {
  const vertices = [];
  const triangles = [];

  text.split(/\r?\n/).forEach((line) => {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === 'v' && parts.length >= 4) {
      vertices.push([Number(parts[1]), Number(parts[2]), Number(parts[3])]);
    }
    if (parts[0] === 'f' && parts.length >= 4) {
      const indexes = parts.slice(1).map((part) => Number(part.split('/')[0]) - 1).filter((index) => vertices[index]);
      for (let i = 1; i + 1 < indexes.length; i += 1) {
        const triangle = [vertices[indexes[0]], vertices[indexes[i]], vertices[indexes[i + 1]]];
        if (isValidTriangle(triangle)) triangles.push(triangle);
      }
    }
  });

  return triangles;
}

export function parseDxf(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([lines[i], lines[i + 1]]);
  const shapes = [];

  for (let i = 0; i < pairs.length; i += 1) {
    if (pairs[i][0] !== '0') continue;
    const type = pairs[i][1];
    const values = {};
    let j = i + 1;
    while (j < pairs.length && pairs[j][0] !== '0') {
      values[pairs[j][0]] = pairs[j][1];
      j += 1;
    }

    if (type === 'LINE') {
      shapes.push({
        type: 'line',
        points: [
          [Number(values['10'] || 0), Number(values['20'] || 0)],
          [Number(values['11'] || 0), Number(values['21'] || 0)],
        ],
      });
    }
    if (type === 'CIRCLE') {
      shapes.push({ type: 'circle', center: [Number(values['10'] || 0), Number(values['20'] || 0)], radius: Number(values['40'] || 0) });
    }
    if (type === 'ARC') {
      shapes.push({
        type: 'arc',
        center: [Number(values['10'] || 0), Number(values['20'] || 0)],
        radius: Number(values['40'] || 0),
        start: Number(values['50'] || 0),
        end: Number(values['51'] || 0),
      });
    }

    i = j - 1;
  }

  return shapes;
}
