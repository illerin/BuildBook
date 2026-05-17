export const APP_VERSION = '0.3.81';

export const STATUSES = ['active', 'paused', 'waiting', 'completed', 'archived'];

export const DEFAULT_CATEGORIES = [
  { id: 'cat-unassigned', name: 'Unassigned', parentId: null, sortOrder: 0 },
  { id: 'cat-capacitors', name: 'Capacitors', parentId: null, sortOrder: 1 },
  { id: 'cat-connectors', name: 'Connectors & Wiring', parentId: null, sortOrder: 2 },
  { id: 'cat-displays', name: 'LEDs & Displays', parentId: null, sortOrder: 3 },
  { id: 'cat-mechanical', name: 'Mechanical & Hardware', parentId: null, sortOrder: 4 },
  { id: 'cat-boards', name: 'Microcontrollers & Development Boards', parentId: null, sortOrder: 5 },
  { id: 'cat-misc', name: 'Miscellaneous', parentId: null, sortOrder: 6 },
  { id: 'cat-modules', name: 'Modules', parentId: null, sortOrder: 7 },
  { id: 'cat-motors', name: 'Motors & Motion', parentId: null, sortOrder: 8 },
  { id: 'cat-optics', name: 'Optics & Physics', parentId: null, sortOrder: 9 },
  { id: 'cat-power', name: 'Power', parentId: null, sortOrder: 10 },
  { id: 'cat-tools', name: 'Prototyping & Tools', parentId: null, sortOrder: 11 },
  { id: 'cat-resistors', name: 'Resistors', parentId: null, sortOrder: 12 },
  { id: 'cat-sensors', name: 'Sensors', parentId: null, sortOrder: 13 },
  { id: 'cat-switches', name: 'Switches & Relays', parentId: null, sortOrder: 14 },
];

export const DEFAULT_FILE_TRACKERS = [
  { id: 'tracker-datasheets', name: 'Datasheets', extensions: '.pdf', viewer: 'pdf', programPath: '' },
  { id: 'tracker-firmware', name: 'Firmware', extensions: '.ino,.cpp,.h', viewer: 'text', programPath: '' },
  { id: 'tracker-drawings', name: 'Drawings', extensions: '.dxf,.dwg', viewer: 'cad', programPath: '' },
  { id: 'tracker-models', name: '3D Models', extensions: '.stl,.step,.obj', viewer: 'model', programPath: '' },
  { id: 'tracker-bom', name: 'PCB BOM', extensions: '.xlsx,.xls,.csv', viewer: 'spreadsheet', programPath: '' },
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

const now = () => new Date().toISOString();

export const DEFAULT_STATE = {
  version: APP_VERSION,
  lanServer: {
    enabled: false,
    port: 8787,
    token: '',
  },
  categories: DEFAULT_CATEGORIES,
  template: {
    steps: DEFAULT_PROJECT_STEPS,
    checklist: ['Add project notes', 'Link parts', 'Attach latest schematic', 'Export build package'],
    fileTrackers: DEFAULT_FILE_TRACKERS,
  },
  projects: [
    {
      id: 'project-bench-power-monitor',
      name: 'Bench Power Monitor',
      status: 'active',
      image: '',
      activeSteps: ['Schematic', 'Testing'],
      notes: 'Document voltage divider values, ADC calibration, enclosure notes, and the final wiring layout.',
      checklist: [
        { id: 'check-1', text: 'Verify ADS1115 gain setting', completedAt: '' },
        { id: 'check-2', text: 'Attach final schematic PDF', completedAt: '' },
      ],
      nextSteps: ['Verify ADS1115 gain setting', 'Attach final schematic PDF'],
      partIds: ['part-ads1115', 'part-oled'],
      partQuantities: {},
      files: [
        {
          id: 'file-ads1115-datasheet',
          trackerId: 'tracker-datasheets',
          name: 'ADS1115.pdf',
          path: '',
          latest: true,
          notes: 'Reference datasheet for gain and sample rate choices.',
          createdAt: now(),
        },
        {
          id: 'file-firmware',
          trackerId: 'tracker-firmware',
          name: 'power-monitor.ino',
          path: '',
          latest: true,
          notes: '',
          createdAt: now(),
        },
      ],
      createdAt: now(),
      updatedAt: now(),
    },
  ],
  parts: [
    {
      id: 'part-ads1115',
      name: 'ADS1115 Module',
      categoryId: 'cat-boards',
      image: '',
      productUrl: '',
      storageLocation: 'Drawer A3',
      specSummary: '16-bit I2C ADC module, configurable gain, 2.0V to 5.5V supply.',
      notes: 'Used for slow precision voltage measurements.',
      documents: [{ id: 'doc-ads1115', name: 'ADS1115.pdf', path: '', type: 'datasheet', createdAt: now() }],
      createdAt: now(),
      updatedAt: now(),
    },
    {
      id: 'part-oled',
      name: 'OLED Display',
      categoryId: 'cat-displays',
      image: '',
      productUrl: '',
      storageLocation: 'Drawer B1',
      specSummary: 'Small I2C display for status readouts.',
      notes: '',
      documents: [],
      createdAt: now(),
      updatedAt: now(),
    },
  ],
  importBatches: [],
};

export function makeId(prefix) {
  if (crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function normalizeState(raw) {
  const state = raw && typeof raw === 'object' ? raw : {};
  const template = state.template || {};
  const rawCategories = Array.isArray(state.categories) && state.categories.length ? state.categories : [];
  const categories = (rawCategories.length ? rawCategories : DEFAULT_CATEGORIES)
    .map((category, index) => ({ sortOrder: index, ...category }));
  const validCategoryIds = new Set(categories.map((category) => category.id));
  const rawSteps = Array.isArray(template.steps) ? template.steps : [];

  return {
    ...DEFAULT_STATE,
    ...state,
    version: APP_VERSION,
    categories,
    template: {
      ...DEFAULT_STATE.template,
      ...template,
      steps: rawSteps.length ? rawSteps : DEFAULT_STATE.template.steps,
      checklist: Array.isArray(template.checklist) ? template.checklist : DEFAULT_STATE.template.checklist,
      fileTrackers: Array.isArray(template.fileTrackers) ? template.fileTrackers : DEFAULT_FILE_TRACKERS,
    },
    projects: (Array.isArray(state.projects) ? state.projects : DEFAULT_STATE.projects).map((project) => ({
      ...project,
      noteImages: Array.isArray(project.noteImages) ? project.noteImages : [],
      files: Array.isArray(project.files) ? project.files : [],
      partIds: Array.isArray(project.partIds) ? project.partIds : [],
      partQuantities: project.partQuantities && typeof project.partQuantities === 'object' ? project.partQuantities : {},
    })),
    parts: (Array.isArray(state.parts) ? state.parts : DEFAULT_STATE.parts).map((part) => ({
      ...part,
      categoryId: validCategoryIds.has(part.categoryId) ? part.categoryId : 'cat-unassigned',
      documents: Array.isArray(part.documents) ? part.documents : [],
    })),
    importBatches: Array.isArray(state.importBatches) ? state.importBatches : [],
    lanServer: {
      enabled: Boolean(state.lanServer?.enabled),
      port: Number(state.lanServer?.port) || DEFAULT_STATE.lanServer.port,
      token: typeof state.lanServer?.token === 'string' ? state.lanServer.token : '',
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
