import assert from 'node:assert/strict';
import {
  limitTriangles,
  parseDxf,
  parseObj,
  parseStl,
} from '../src/filePreviewParsers.js';

const stl = new TextEncoder().encode(`
solid sample
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex 1 0 0
vertex 0 1 0
endloop
endfacet
endsolid sample
`);
assert.deepEqual(parseStl(stl), [[[0, 0, 0], [1, 0, 0], [0, 1, 0]]]);

const objTriangles = parseObj(`
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
f 1 2 3 4
`);
assert.equal(objTriangles.length, 2);
assert.deepEqual(objTriangles[0], [[0, 0, 0], [1, 0, 0], [1, 1, 0]]);

const shapes = parseDxf(`0
SECTION
0
LINE
10
0
20
0
11
10
21
5
0
CIRCLE
10
2
20
3
40
4
0
ENDSEC
`);
assert.deepEqual(shapes[0], { type: 'line', points: [[0, 0], [10, 5]] });
assert.deepEqual(shapes[1], { type: 'circle', center: [2, 3], radius: 4 });

assert.deepEqual(limitTriangles([1, 2, 3, 4, 5], 2), [1, 4]);

console.log('File preview parser smoke check passed.');
