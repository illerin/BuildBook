export const APP_VERSION = '0.3.143';

export const STATUSES = ['active', 'paused', 'waiting', 'completed', 'archived'];

export const DEFAULT_CATEGORIES = [
  { id: 'cat-unassigned', name: 'Unassigned', parentId: null, sortOrder: 0 },
  { id: 'cat-3c9d9111-0569-4a10-8fc8-470ded424aeb', name: "Custom PCB's", parentId: null, sortOrder: 1 },
  { id: 'cat-web-13', name: 'Microcontrollers & Development Boards', parentId: null, sortOrder: 2 },
  { id: 'cat-ac6da2e8-e4db-4c22-a1ac-dbe42f1b68d9', name: 'ESP32', parentId: 'cat-web-13', sortOrder: 3 },
  { id: 'cat-3db2c34e-ee9d-43e9-bcd9-936fbb4c7f6c', name: 'Arduino', parentId: 'cat-web-13', sortOrder: 4 },
  { id: 'cat-web-11', name: 'Modules', parentId: null, sortOrder: 5 },
  { id: 'cat-281a2446-0b4c-4e29-b1f1-dbd2e099751e', name: 'Displays', parentId: 'cat-web-11', sortOrder: 6 },
  { id: 'cat-web-2', name: 'Sensors', parentId: 'cat-web-11', sortOrder: 7 },
  { id: 'cat-8fc83b9e-3e60-4a58-92db-38940d1801e6', name: 'Circuit Board Parts', parentId: null, sortOrder: 8 },
  { id: 'cat-2f679848-6122-4a15-9e23-ed078ad116c7', name: "IC's", parentId: 'cat-8fc83b9e-3e60-4a58-92db-38940d1801e6', sortOrder: 9 },
  { id: 'cat-web-7', name: 'LEDs', parentId: 'cat-8fc83b9e-3e60-4a58-92db-38940d1801e6', sortOrder: 10 },
  { id: 'cat-77762324-17ab-4447-8e42-41e3fe55b863', name: 'Diodes', parentId: 'cat-web-7', sortOrder: 11 },
  { id: 'cat-fcd7a999-4a1c-43c1-8286-97e05e9d68ee', name: 'LED Strings', parentId: 'cat-web-7', sortOrder: 12 },
  { id: 'cat-web-1', name: 'Resistors', parentId: 'cat-8fc83b9e-3e60-4a58-92db-38940d1801e6', sortOrder: 13 },
  { id: 'cat-web-6', name: 'Capacitors', parentId: 'cat-8fc83b9e-3e60-4a58-92db-38940d1801e6', sortOrder: 14 },
  { id: 'cat-606b7d9c-9708-4a94-a0e7-f7bd610ff299', name: 'Inductors', parentId: 'cat-8fc83b9e-3e60-4a58-92db-38940d1801e6', sortOrder: 15 },
  { id: 'cat-ccf6892a-0f10-46d5-97c2-b14f79f58aa0', name: 'Diodes', parentId: 'cat-8fc83b9e-3e60-4a58-92db-38940d1801e6', sortOrder: 16 },
  { id: 'cat-web-3', name: 'Switches & Relays', parentId: 'cat-8fc83b9e-3e60-4a58-92db-38940d1801e6', sortOrder: 17 },
  { id: 'cat-web-14', name: 'Power', parentId: null, sortOrder: 18 },
  { id: 'cat-fc1396e8-bb2f-4cae-ba6f-4cec780ba629', name: 'Power Supplies', parentId: 'cat-web-14', sortOrder: 19 },
  { id: 'cat-54051390-3617-46a2-af17-90fa243a4451', name: 'Power Modules', parentId: 'cat-web-14', sortOrder: 20 },
  { id: 'cat-1257d198-70de-4bd2-add4-a8938cc0ef93', name: 'LED Current Supplies', parentId: 'cat-web-14', sortOrder: 21 },
  { id: 'cat-a6de9175-7170-418e-9fff-3192b71089f7', name: 'Battery', parentId: 'cat-web-14', sortOrder: 22 },
  { id: 'cat-web-4', name: 'Mechanical & Hardware', parentId: null, sortOrder: 23 },
  { id: 'cat-web-34', name: 'Nuts, Bolts & Screws', parentId: 'cat-web-4', sortOrder: 24 },
  { id: 'cat-web-35', name: 'Nuts', parentId: 'cat-web-34', sortOrder: 25 },
  { id: 'cat-web-36', name: 'Bolts', parentId: 'cat-web-34', sortOrder: 26 },
  { id: 'cat-web-37', name: 'Screws', parentId: 'cat-web-34', sortOrder: 27 },
  { id: 'cat-web-5', name: 'Motors & Motion', parentId: null, sortOrder: 28 },
  { id: 'cat-83ddc78b-8aca-41de-9d86-c19c7c445b68', name: 'Magnets', parentId: null, sortOrder: 29 },
  { id: 'cat-d93e885b-19ca-4b9e-9e48-7af0f9457ba1', name: 'Cooling', parentId: null, sortOrder: 30 },
  { id: 'cat-c4e3c424-ad01-4402-a6e4-03d5946ff05e', name: 'Sound', parentId: null, sortOrder: 31 },
  { id: 'cat-web-12', name: 'Optics & Physics', parentId: null, sortOrder: 32 },
  { id: 'cat-web-10', name: 'Connectors & Wiring', parentId: null, sortOrder: 33 },
  { id: 'cat-web-9', name: 'Prototyping & Tools', parentId: null, sortOrder: 34 },
  { id: 'cat-web-8', name: 'Miscellaneous', parentId: null, sortOrder: 35 },
  { id: 'cat-4cfcf916-3b15-4e31-9b98-d3084857bb61', name: 'Tape', parentId: 'cat-web-8', sortOrder: 36 },
];

export const DEFAULT_FILE_TRACKERS = [
  { id: 'tracker-datasheets', name: 'Datasheets', extensions: '.pdf', viewer: 'pdf', programPath: '', color: '#58a6ff' },
  { id: 'tracker-firmware', name: 'Firmware', extensions: '.ino,.cpp,.h', viewer: 'text', programPath: '', color: '#56d364' },
  { id: 'tracker-drawings', name: 'Drawings', extensions: '.dxf,.dwg', viewer: 'cad', programPath: '', color: '#d29922' },
  { id: 'tracker-models', name: '3D Models', extensions: '.stl,.step,.obj', viewer: 'model', programPath: '', color: '#f778ba' },
  { id: 'tracker-bom', name: 'PCB BOM', extensions: '.xlsx,.xls,.csv', viewer: 'spreadsheet', programPath: '', color: '#bc8cff' },
];

export const DEFAULT_PROJECT_STEPS = [
  'Design',
  'Schematic',
  'PCB Layout',
  'Parts',
  'Assembly',
  'Programming',
  'Testing',
  'Debugging',
  'Enclosure',
  'Documentation',
];

export const DEFAULT_THEME = {
  bg: '#0f1117',
  sidebar: '#161b22',
  surface: '#161b22',
  surfaceRaised: '#21262d',
  field: '#0d1117',
  border: '#30363d',
  borderSoft: '#21262d',
  text: '#e1e4e8',
  textMuted: '#8b949e',
  textSoft: '#c9d1d9',
  accent: '#58a6ff',
  accentFill: '#1f6feb',
  success: '#238636',
  successHover: '#2ea043',
  danger: '#da3633',
  dangerHover: '#f85149',
  warning: '#d29922',
  projectTagBg: '#1b3a5a',
  projectTagText: '#79c0ff',
  statusActiveBg: '#1f6231',
  statusActiveText: '#7ee787',
  statusPausedBg: '#2d333b',
  statusPausedText: '#adbac7',
  statusWaitingBg: '#5a3e1b',
  statusWaitingText: '#d29922',
  statusCompletedBg: '#1b3a5a',
  statusCompletedText: '#79c0ff',
  statusArchivedBg: '#3d2a6b',
  statusArchivedText: '#d2a8ff',
};

const now = () => new Date().toISOString();

export const DEFAULT_STATE = {
  version: APP_VERSION,
  closeToTray: false,
  lanServer: {
    enabled: false,
    port: 8787,
    token: '',
    requireToken: true,
  },
  theme: DEFAULT_THEME,
  categories: DEFAULT_CATEGORIES,
  template: {
    steps: DEFAULT_PROJECT_STEPS,
    checklist: ['Add project notes', 'Link parts', 'Attach latest schematic', 'Export build package'],
    fileTrackers: DEFAULT_FILE_TRACKERS,
  },
  projects: [],
  parts: [],
  importBatches: [],
};

export function makeId(prefix) {
  if (crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function normalizeState(raw, options = {}) {
  const state = raw && typeof raw === 'object' ? raw : {};
  const template = state.template || {};
  const rawCategories = Array.isArray(state.categories) && state.categories.length ? state.categories : [];
  const importedCategories = options.preserveImportedCategories && Array.isArray(state.categories)
    ? (state.categories.some((category) => category.id === 'cat-unassigned')
        ? state.categories
        : [{ id: 'cat-unassigned', name: 'Unassigned', parentId: null, sortOrder: 0 }, ...state.categories])
    : null;
  const categories = (importedCategories || (rawCategories.length ? rawCategories : DEFAULT_CATEGORIES))
    .map((category, index) => ({ sortOrder: index, ...category }));
  const validCategoryIds = new Set(categories.map((category) => category.id));
  const rawSteps = Array.isArray(template.steps) ? template.steps : [];

  return {
    ...DEFAULT_STATE,
    ...state,
    version: APP_VERSION,
    closeToTray: Boolean(state.closeToTray),
    categories,
    theme: {
      ...DEFAULT_THEME,
      ...(state.theme && typeof state.theme === 'object' ? state.theme : {}),
    },
    template: {
      ...DEFAULT_STATE.template,
      ...template,
      steps: rawSteps.length ? rawSteps : DEFAULT_STATE.template.steps,
      checklist: Array.isArray(template.checklist) ? template.checklist : DEFAULT_STATE.template.checklist,
      fileTrackers: (Array.isArray(template.fileTrackers) ? template.fileTrackers : DEFAULT_FILE_TRACKERS).map((tracker, index) => ({
        ...tracker,
        color: tracker.color || DEFAULT_FILE_TRACKERS[index % DEFAULT_FILE_TRACKERS.length]?.color || '#58a6ff',
      })),
    },
    projects: (Array.isArray(state.projects) ? state.projects : DEFAULT_STATE.projects).map((project) => ({
      ...project,
      noteImages: Array.isArray(project.noteImages) ? project.noteImages : [],
      files: Array.isArray(project.files) ? project.files.map((file) => ({
        ...file,
        trackedItemId: file.trackedItemId || file.id,
      })) : [],
      partIds: Array.isArray(project.partIds) ? project.partIds : [],
      partQuantities: project.partQuantities && typeof project.partQuantities === 'object' ? project.partQuantities : {},
      photoFolders: Array.isArray(project.photoFolders) ? project.photoFolders.map((folder) => ({
        ...folder,
        photos: Array.isArray(folder.photos) ? folder.photos : [],
      })) : [],
      instructions: project.instructions && typeof project.instructions === 'object' ? {
        intro: project.instructions.intro || '',
        steps: Array.isArray(project.instructions.steps) ? project.instructions.steps : [],
      } : { intro: '', steps: [] },
    })),
    parts: (Array.isArray(state.parts) ? state.parts : DEFAULT_STATE.parts).map((part) => ({
      ...part,
      imageThumbnail: part.imageThumbnail || '',
      categoryId: validCategoryIds.has(part.categoryId) ? part.categoryId : 'cat-unassigned',
      documents: Array.isArray(part.documents) ? part.documents : [],
    })),
    importBatches: Array.isArray(state.importBatches) ? state.importBatches : [],
    lanServer: {
      enabled: Boolean(state.lanServer?.enabled),
      port: Number(state.lanServer?.port) || DEFAULT_STATE.lanServer.port,
      token: typeof state.lanServer?.token === 'string' ? state.lanServer.token : '',
      requireToken: state.lanServer?.requireToken !== false,
    },
  };
}

export function categoryLabel(categories, categoryId) {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const names = [];
  let current = byId.get(categoryId);

  while (current) {
    names.unshift(current.name);
    current = byId.get(current.parentId);
  }

  return names.join(' / ') || 'Unassigned';
}

export function fileTrackerLabel(trackers, trackerId) {
  return trackers.find((tracker) => tracker.id === trackerId)?.name || 'Files';
}


