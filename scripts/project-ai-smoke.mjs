import assert from 'node:assert/strict';
import {
  DEFAULT_PROJECT_TABS,
  normalizeProjectAiPermissions,
  normalizeProjectTabs,
} from '../src/data.js';
import {
  aiProviderResponseText,
  applyAiActions,
  buildAiProviderRequest,
  filterAiActions,
  parseAiProviderResponse,
  parseAiResponse,
  sendProjectAiMessage,
} from '../src/projectAi.js';
import {
  BUILDBOOK_AI_MANIFEST,
  aiToolsForPermissions,
  executeAiTool,
} from '../src/projectAiTools.js';

assert.deepEqual(normalizeProjectTabs(undefined), DEFAULT_PROJECT_TABS);
assert.equal(normalizeProjectTabs(['overview', 'ai', 'unknown']).join(','), 'overview,ai');
assert.deepEqual(normalizeProjectAiPermissions({ files: 'write', photos: 'invalid' }), {
  overview: 'none',
  instructions: 'none',
  photos: 'none',
  parts: 'none',
  files: 'write',
  libraryParts: 'read',
  webResearch: 'none',
});

const permissions = normalizeProjectAiPermissions({ overview: 'write', files: 'read' });
const parsed = parseAiResponse(
  'Done.\n```buildbook-actions\n[{"type":"add_checklist_item","text":"Test it"},{"type":"set_file_notes","fileId":"f1","value":"Blocked"}]\n```',
  permissions,
);
assert.equal(parsed.content, 'Done.');
assert.deepEqual(parsed.actions.map((action) => action.type), ['add_checklist_item']);
assert.equal(filterAiActions(parsed.actions, normalizeProjectAiPermissions({})).length, 0);

const project = {
  notes: '',
  noteSheets: [{ id: 'project-notes', title: 'Project Notes', content: '' }],
  checklist: [],
  partIds: [],
  partQuantities: {},
  photoFolders: [],
  files: [],
  instructions: { intro: '', steps: [] },
};
const updated = applyAiActions(project, [
  { type: 'set_overview_notes', value: 'Scoped note' },
  { type: 'add_checklist_item', text: 'Test it' },
], []);
assert.equal(updated.notes, 'Scoped note');
assert.equal(updated.noteSheets[0].content, 'Scoped note');
assert.equal(updated.checklist[0].text, 'Test it');

const requestBase = {
  context: 'Current project only',
  history: [{ role: 'assistant', content: 'Prior answer' }],
  prompt: 'Next question',
  permissions,
  images: [{ label: 'Photo', dataUrl: 'data:image/png;base64,AAAA' }],
};
const openAiRequest = buildAiProviderRequest({
  ...requestBase,
  connection: { provider: 'openai', endpoint: 'https://api.openai.com/v1/chat/completions', model: 'test-model', apiKey: 'key' },
});
assert.equal(openAiRequest.options.headers.Authorization, 'Bearer key');
assert.equal(JSON.parse(openAiRequest.options.body).messages.at(-1).content[1].type, 'image_url');

const anthropicRequest = buildAiProviderRequest({
  ...requestBase,
  connection: { provider: 'anthropic', endpoint: 'https://api.anthropic.com/v1/messages', model: 'test-model', apiKey: 'key' },
});
assert.equal(anthropicRequest.options.headers['anthropic-version'], '2023-06-01');
assert.equal(JSON.parse(anthropicRequest.options.body).messages.at(-1).content[1].type, 'image');

const geminiRequest = buildAiProviderRequest({
  ...requestBase,
  connection: { provider: 'gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta', model: 'test-model', apiKey: 'key' },
});
assert.equal(geminiRequest.url, 'https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent');
assert.equal(JSON.parse(geminiRequest.options.body).contents.at(-1).parts[1].inline_data.mime_type, 'image/png');

assert.equal(aiProviderResponseText('openai', { choices: [{ message: { content: 'OpenAI answer' } }] }), 'OpenAI answer');
assert.equal(aiProviderResponseText('anthropic', { content: [{ type: 'text', text: 'Claude answer' }] }), 'Claude answer');
assert.equal(aiProviderResponseText('gemini', { candidates: [{ content: { parts: [{ text: 'Gemini answer' }] } }] }), 'Gemini answer');

const toolPermissions = normalizeProjectAiPermissions({ files: 'read', parts: 'write', libraryParts: 'write' });
assert.equal(BUILDBOOK_AI_MANIFEST.tabs.files.purpose.includes('Tracked project files'), true);
assert.equal(aiToolsForPermissions(toolPermissions).some((tool) => tool.name === 'create_part_draft'), true);
const toolContext = {
  project: { id: 'p1', name: 'Project', status: 'active', notes: '', noteSheets: [], checklist: [], nextSteps: [], instructions: { intro: '', steps: [] }, photoFolders: [], partIds: [], partQuantities: {}, files: [] },
  parts: [{ id: 'part-1', name: 'NE555 Timer', categoryId: 'cat-unassigned', productUrl: '', storageLocation: '', specSummary: 'Timer IC', notes: '', documents: [] }],
  categories: [{ id: 'cat-unassigned', name: 'Unassigned', parentId: null }],
  template: { fileTrackers: [] },
  permissions: toolPermissions,
};
const partSearch = await executeAiTool('search_parts', { query: 'NE555' }, toolContext);
assert.equal(partSearch.output[0].id, 'part-1');
const partDraft = await executeAiTool('create_part_draft', {
  name: 'LM358',
  specSummary: 'Dual operational amplifier',
  sources: [{ title: 'Manufacturer', url: 'https://example.com/lm358', retrievedAt: '2026-07-03' }],
}, toolContext);
assert.equal(partDraft.proposals[0].type, 'create_part');
assert.equal(partDraft.proposals[0].notes.includes('https://example.com/lm358'), true);

const parsedOpenAiTool = parseAiProviderResponse('openai', {
  choices: [{ message: { content: '', tool_calls: [{ id: 'call-1', function: { name: 'search_parts', arguments: '{"query":"LM358"}' } }] } }],
});
assert.equal(parsedOpenAiTool.toolCalls[0].arguments.query, 'LM358');
const parsedClaudeTool = parseAiProviderResponse('anthropic', {
  content: [{ type: 'tool_use', id: 'call-2', name: 'get_part', input: { partId: 'part-1' } }],
});
assert.equal(parsedClaudeTool.toolCalls[0].name, 'get_part');
const parsedGeminiTool = parseAiProviderResponse('gemini', {
  candidates: [{ content: { parts: [{ functionCall: { id: 'call-3', name: 'search_project', args: { query: 'timer' } } }] } }],
});
assert.equal(parsedGeminiTool.toolCalls[0].arguments.query, 'timer');

const originalFetch = globalThis.fetch;
let toolLoopCalls = 0;
globalThis.fetch = async (_url, options) => {
  toolLoopCalls += 1;
  const request = JSON.parse(options.body);
  if (toolLoopCalls === 1) {
    return {
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: '',
            tool_calls: [{ id: 'call-loop', function: { name: 'search_parts', arguments: '{"query":"NE555"}' } }],
          },
        }],
        usage: { prompt_tokens: 10, completion_tokens: 2 },
      }),
    };
  }
  assert.equal(request.messages.some((message) => message.role === 'tool'), true);
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content: 'The NE555 Timer is already in the library.' } }],
      usage: { prompt_tokens: 20, completion_tokens: 8 },
    }),
  };
};
const loopResult = await sendProjectAiMessage({
  connection: {
    provider: 'openai',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'test-model',
    apiKey: 'key',
    toolsEnabled: true,
    visionEnabled: true,
    webSearchEnabled: false,
  },
  context: 'Current project only',
  history: [],
  prompt: 'Do I have an NE555?',
  permissions: toolPermissions,
  images: [],
  toolContext,
});
globalThis.fetch = originalFetch;
assert.equal(loopResult.content.includes('already in the library'), true);
assert.equal(toolLoopCalls, 2);

console.log('Project AI smoke check passed.');
