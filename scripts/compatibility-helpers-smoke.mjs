import assert from 'node:assert/strict';
import {
  asArray,
  buildBomCsv,
  buildGuideHtml,
  buildInstructionsHtml,
  buildProjectReadme,
  findMatchingTracker,
  guessWebFileType,
  parseWebMetadataArray,
  stripHtml,
  webDate,
  webId,
  webTrackerId,
  webTrackerKey,
  webUploadName,
  webUploadPath,
} from '../src/compatibility.js';

assert.equal(webUploadPath('images', 'part.png'), 'uploads/images/part.png');
assert.equal(webUploadPath('images', ''), '');

assert.equal(webId('part', 42), 'part-web-42');
assert.equal(webDate('2026-01-02T03:04:05.000Z'), '2026-01-02T03:04:05.000Z');

assert.equal(webTrackerId('datasheet'), 'tracker-web-datasheet');
assert.equal(webTrackerId(''), 'tracker-web-other');
assert.equal(webTrackerKey('tracker-web-drawing'), 'drawing');
assert.equal(webTrackerKey('tracker-datasheets'), 'datasheet');
assert.equal(webTrackerKey('tracker-custom'), 'custom');

const trackerOptions = [
  { id: 'tracker-datasheets', name: 'Datasheets', extensions: '.pdf' },
  { id: 'tracker-firmware', name: 'Firmware', extensions: '.ino,.cpp,.h' },
  { id: 'tracker-custom', name: 'CAD Files', extensions: '.step,.stl' },
];
assert.equal(findMatchingTracker(trackerOptions, { id: 'tracker-datasheets', name: 'Other', extensions: '' })?.id, 'tracker-datasheets');
assert.equal(findMatchingTracker(trackerOptions, { id: 'new', name: 'Firmware', extensions: '' })?.id, 'tracker-firmware');
assert.equal(findMatchingTracker(trackerOptions, { id: 'new', name: 'Models', extensions: '.stl,.step' })?.id, 'tracker-custom');
assert.equal(findMatchingTracker(trackerOptions, { id: 'new', name: 'Unknown', extensions: '.zip' }), null);

assert.equal(guessWebFileType('manual.pdf'), 'pdf');
assert.equal(guessWebFileType('photo.webp'), 'image');
assert.equal(guessWebFileType('firmware.ino'), 'file');

assert.equal(webUploadName('project-file', 7, 'Folder/Board Rev A.step'), 'project-file-7-Board Rev A.step');
assert.deepEqual(asArray([1, 2]), [1, 2]);
assert.deepEqual(asArray(null), []);
assert.deepEqual(parseWebMetadataArray([{ key: 'file_trackers', value: '[{"key":"bom"}]' }], 'file_trackers'), [{ key: 'bom' }]);
assert.deepEqual(parseWebMetadataArray([{ key: 'file_trackers', value: '{bad json' }], 'file_trackers'), []);

const project = {
  name: 'Amp <Test>',
  status: 'active',
  activeSteps: ['Wire'],
  notes: 'Keep <safe>',
  checklist: [{ text: 'Check "fit"', completedAt: '' }],
  nextSteps: ['Test'],
  files: [{ trackerId: 'tracker-datasheets', name: 'manual.pdf', latest: true, notes: 'Rev A' }],
  partIds: ['part-1'],
  partQuantities: { 'part-1': 2 },
  instructions: { intro: '<p>Intro</p>', steps: [{ title: 'Install', body: '<p>Done</p>' }] },
};
const parts = [{ id: 'part-1', name: 'Resistor', categoryId: 'cat-unassigned', storageLocation: 'Bin 1', productUrl: 'https://example.test', specSummary: '10k' }];
const categories = [{ id: 'cat-unassigned', name: 'Unassigned', parentId: null }];
const trackers = [{ id: 'tracker-datasheets', name: 'Datasheets', extensions: '.pdf' }];

assert.match(buildProjectReadme(project, parts, categories, trackers), /# Amp <Test>/);
assert.match(buildBomCsv(parts, categories), /"Resistor","Unassigned","Bin 1","https:\/\/example.test","10k"/);
assert.match(buildGuideHtml(project, parts, categories, trackers), /Amp &lt;Test&gt; Build Guide/);
assert.match(buildInstructionsHtml(project, parts), /Qty 2/);
assert.equal(stripHtml('<p>A&nbsp;&amp;&lt;&gt;</p><br>B'), 'A &<>\n\n\nB');

console.log('Compatibility helper smoke check passed.');
