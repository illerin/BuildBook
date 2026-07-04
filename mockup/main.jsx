import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './mockup.css';

const DEFAULTS = {
  canvas: '#101418',
  surface: '#1c232b',
  text: '#e8edf2',
  accent: '#4da3ff',
  success: '#62c08a',
  density: 'compact',
  sidebarWidth: 200,
  rowHeight: 66,
  radius: 4,
  sectionStyle: 'dividers',
  thumbnails: true,
};

const projects = [
  { id: 'power', name: 'Workbench Power Monitor', next: 'Calibrate voltage sensor', status: 'Active', progress: '7/12 (58%)', parts: 23, files: 4, updated: 'May 12', image: '/sample%20images/Project%20overview.PNG' },
  { id: 'weather', name: 'Weather Station', next: 'Assemble enclosure', status: 'Active', progress: '9/14 (64%)', parts: 31, files: 6, updated: 'May 11', image: '/sample%20images/Project%20Files.PNG' },
  { id: 'cnc', name: 'CNC Dust Controller', next: 'Tune fan curve', status: 'Waiting', progress: '5/9 (56%)', parts: 18, files: 3, updated: 'May 9', image: '/sample%20images/Parts%20Library.PNG' },
  { id: 'lora', name: 'LoRa Sensor Node', next: 'Field test range', status: 'Active', progress: '8/11 (73%)', parts: 17, files: 5, updated: 'May 8', image: '/sample%20images/Project%20overview.PNG' },
  { id: 'clock', name: 'LED Matrix Clock', next: 'Refine animations', status: 'Paused', progress: '6/10 (60%)', parts: 22, files: 4, updated: 'May 7', image: '/sample%20images/Project%20Files.PNG' },
];

const parts = [
  { id: 'esp32', name: 'ESP32-S3 DevKit', category: 'Microcontrollers', storage: 'Cabinet A / Bin 4', projects: 12, docs: 3, stock: 18 },
  { id: 'ina219', name: 'INA219 Current Sensor', category: 'Sensors', storage: 'Cabinet A / Bin 6', projects: 8, docs: 2, stock: 24 },
  { id: 'oled', name: 'OLED Display 1.3 inch', category: 'Displays', storage: 'Cabinet B / Bin 2', projects: 9, docs: 4, stock: 11 },
  { id: 'xt60', name: 'XT60 Connector', category: 'Power', storage: 'Cabinet A / Bin 3', projects: 15, docs: 1, stock: 40 },
  { id: 'insert', name: 'M3 Heat-Set Insert', category: 'Hardware', storage: 'Cabinet C / Bin 8', projects: 3, docs: 1, stock: 120 },
  { id: 'resistor', name: '10kΩ Resistor 1%', category: 'Electronics', storage: 'Cabinet C / Bin 1', projects: 21, docs: 0, stock: 350 },
];

function Toggle({ checked, onChange, label }) {
  return (
    <label className="toggle-row">
      <button
        type="button"
        className={`toggle ${checked ? 'on' : ''}`}
        aria-pressed={checked}
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
      <span>{label}</span>
    </label>
  );
}

function Studio({ settings, setSettings, onClose }) {
  const update = (patch) => setSettings((current) => ({ ...current, ...patch }));
  const copySettings = async () => {
    await navigator.clipboard?.writeText(JSON.stringify(settings, null, 2));
  };

  return (
    <aside className="studio">
      <header>
        <div>
          <strong>Layout Studio</strong>
          <span>Prototype controls</span>
        </div>
        <button className="icon-button" title="Close studio" onClick={onClose}>×</button>
      </header>

      <section>
        <h3>Five Colors</h3>
        {[
          ['canvas', 'Canvas'],
          ['surface', 'Surface'],
          ['text', 'Text + dividers'],
          ['accent', 'Actions + links'],
          ['success', 'Active + success'],
        ].map(([key, label]) => (
          <label className="color-row" key={key}>
            <input type="color" value={settings[key]} onChange={(event) => update({ [key]: event.target.value })} />
            <span>{label}</span>
            <code>{settings[key].toUpperCase()}</code>
          </label>
        ))}
      </section>

      <section>
        <h3>Layout</h3>
        <label className="control-row">
          <span>Density</span>
          <select value={settings.density} onChange={(event) => update({ density: event.target.value })}>
            <option value="compact">Compact</option>
            <option value="comfortable">Comfortable</option>
          </select>
        </label>
        <label className="slider-row">
          <span>Sidebar width <output>{settings.sidebarWidth}px</output></span>
          <input type="range" min="180" max="280" step="4" value={settings.sidebarWidth} onChange={(event) => update({ sidebarWidth: Number(event.target.value) })} />
        </label>
        <label className="slider-row">
          <span>List row height <output>{settings.rowHeight}px</output></span>
          <input type="range" min="52" max="92" step="2" value={settings.rowHeight} onChange={(event) => update({ rowHeight: Number(event.target.value) })} />
        </label>
        <label className="slider-row">
          <span>Corner radius <output>{settings.radius}px</output></span>
          <input type="range" min="0" max="8" step="1" value={settings.radius} onChange={(event) => update({ radius: Number(event.target.value) })} />
        </label>
        <label className="control-row">
          <span>Sections</span>
          <select value={settings.sectionStyle} onChange={(event) => update({ sectionStyle: event.target.value })}>
            <option value="dividers">Dividers</option>
            <option value="panels">Panels</option>
          </select>
        </label>
        <Toggle checked={settings.thumbnails} onChange={(value) => update({ thumbnails: value })} label="Show thumbnails" />
      </section>

      <footer>
        <button className="secondary" onClick={() => setSettings(DEFAULTS)}>Reset</button>
        <button onClick={copySettings}>Copy settings</button>
      </footer>
    </aside>
  );
}

function AppSidebar({ page, setPage, width }) {
  const settingsOpen = ['tracked', 'network', 'settings'].includes(page);
  return (
    <aside className="app-sidebar" style={{ width }}>
      <div className="brand">
        <strong>BuildBook</strong>
        <span>v0.4 prototype</span>
      </div>
      <nav>
        <button className={['projects', 'project'].includes(page) ? 'active' : ''} onClick={() => setPage('projects')}>Projects</button>
        <button className={`sub-nav ${page === 'completed' ? 'active' : ''}`} onClick={() => setPage('completed')}>Completed Projects</button>
        <button className={['parts', 'part'].includes(page) ? 'active' : ''} onClick={() => setPage('parts')}>Parts Library</button>
        <button className={page === 'search' ? 'active' : ''} onClick={() => setPage('search')}>Search</button>
        <button className={page === 'imports' ? 'active' : ''} onClick={() => setPage('imports')}>Imports</button>
        <button className={settingsOpen ? 'active' : ''} onClick={() => setPage('tracked')}>Settings</button>
        {settingsOpen && (
          <>
            <button className={`settings-sub-nav ${page === 'tracked' ? 'active' : ''}`} onClick={() => setPage('tracked')}>Workspace Setup</button>
            <button className={`settings-sub-nav ${page === 'settings' ? 'active' : ''}`} onClick={() => setPage('settings')}>Maintenance</button>
            <button className={`settings-sub-nav ${page === 'network' ? 'active' : ''}`} onClick={() => setPage('network')}>Network & Sync</button>
          </>
        )}
      </nav>
      <div className="sidebar-status">Saved</div>
    </aside>
  );
}

function PageHeader({ title, children, back }) {
  return (
    <header className="page-header">
      <div className="title-row">
        {back && <button className="icon-button" title="Go back" onClick={back}>←</button>}
        <h1>{title}</h1>
      </div>
      <div className="header-actions">{children}</div>
    </header>
  );
}

function ViewToggle({ value, onChange }) {
  return (
    <div className="view-toggle" aria-label="View style">
      <button className={value === 'cards' ? 'active' : ''} onClick={() => onChange('cards')}>Cards</button>
      <button className={value === 'list' ? 'active' : ''} onClick={() => onChange('list')}>List</button>
    </div>
  );
}

function ProjectsPage({ openProject, thumbnails, view, setView }) {
  return (
    <>
      <PageHeader title="Projects">
        <input className="search-input" placeholder="Search projects..." />
        <div className="segments">
          <button className="active">Open</button><button>All</button><button>Active</button><button>Waiting</button>
        </div>
        <ViewToggle value={view} onChange={setView} />
        <button>New Project</button>
      </PageHeader>
      <section className="page-section">
        <div className="section-heading"><h2>Open Projects</h2><span>{projects.length} projects</span></div>
        {view === 'cards' ? (
          <div className="mock-project-grid">
            {projects.map((project) => (
              <button key={project.id} className="mock-project-card" onClick={() => openProject(project)}>
                <div className="mock-project-image">
                  {thumbnails ? <img src={project.image} alt="" /> : <span>Project</span>}
                  <em>{project.status}</em>
                </div>
                <div className="mock-project-body">
                  <strong>{project.name}</strong>
                  <small>Next: {project.next}</small>
                  <div className="mock-tags"><span>Design</span><span>Build</span><span>Test</span></div>
                  <div className="mock-meta"><span>{project.parts} parts</span><span>{project.progress}</span><span>{project.files} files</span></div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="data-head project-columns">
              <span>Project</span><span>Status</span><span>Progress</span><span>Parts</span><span>Files</span><span>Updated</span>
            </div>
            <div className="data-list">
              {projects.map((project) => (
                <button key={project.id} className="data-row project-columns" onClick={() => openProject(project)}>
                  <span className="primary-cell">
                    {thumbnails && <img src={project.image} alt="" />}
                    <span><strong>{project.name}</strong><small>Next: {project.next}</small><em>Design · Build · Test</em></span>
                  </span>
                  <span className={project.status === 'Active' ? 'success-text' : ''}>{project.status}</span>
                  <span className="success-text">{project.progress}</span>
                  <span>{project.parts}</span><span>{project.files}</span><span>{project.updated}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </section>
    </>
  );
}

function ProjectPage({ project, back }) {
  const selected = project || projects[0];
  return (
    <>
      <PageHeader title={selected.name} back={back}>
        <span className="status-dot">Active</span>
        <button>Add</button>
        <button className="icon-button" title="More project actions">⋮</button>
      </PageHeader>
      <div className="tabs"><button className="active">Overview</button><button>Instructions</button><button>Photos</button><button>Parts</button><button>Files</button></div>
      <div className="overview-grid">
        <section className="content-section">
          <h2>Project Notes</h2>
          <p>This project monitors AC and DC output from the workbench power supply.</p>
          <p>ESP32 reads voltage and current sensors and displays data on the OLED. Measurements are logged to an SD card.</p>
        </section>
        <section className="content-section">
          <h2>Next Steps</h2>
          <ol className="simple-list"><li>Complete firmware logging routine</li><li>Add settings menu to OLED interface</li><li>Finish enclosure labels</li></ol>
        </section>
        <section className="content-section">
          <h2>Checklist</h2>
          <ul className="check-list"><li className="done">Define requirements</li><li className="done">Design enclosure</li><li>Write firmware</li><li>Test and calibrate</li></ul>
        </section>
        <section className="content-section">
          <h2>Latest Files</h2>
          <ul className="file-list"><li><strong>Enclosure Model.step</strong><span>5.2 MB</span></li><li><strong>Firmware v12.ino</strong><span>18 KB</span></li><li><strong>Wiring Diagram.pdf</strong><span>342 KB</span></li></ul>
        </section>
      </div>
    </>
  );
}

function PartsPage({ openPart, thumbnails, view, setView }) {
  return (
    <>
      <PageHeader title="Parts Library">
        <input className="search-input" placeholder="Search parts..." />
        <ViewToggle value={view} onChange={setView} />
        <button>New Part</button>
      </PageHeader>
      <div className="parts-layout">
        <aside className="category-list">
          <h2>Categories</h2>
          {['All Parts', 'Electronics', 'Microcontrollers', 'Sensors', 'Power', 'Mechanical', 'Hardware'].map((category, index) => (
            <button className={index === 0 ? 'active' : ''} key={category}>{category}<span>{[1248, 512, 156, 198, 142, 164, 76][index]}</span></button>
          ))}
        </aside>
        <section className="page-section parts-table">
          {view === 'cards' ? (
            <div className="mock-part-grid">
              {parts.map((part) => (
                <button key={part.id} className="mock-part-card" onClick={() => openPart(part)}>
                  <div className="mock-part-image">{thumbnails ? part.name.slice(0, 2).toUpperCase() : 'Part'}</div>
                  <div className="mock-part-body">
                    <span>{part.category}</span>
                    <strong>{part.name}</strong>
                    <p>{part.storage}</p>
                    <div className="mock-meta"><span>{part.docs} docs</span><span>{part.projects} projects</span></div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <>
              <div className="data-head part-columns"><span>Part</span><span>Category</span><span>Storage</span><span>Projects</span><span>Docs</span></div>
              <div className="data-list">
                {parts.map((part) => (
                  <button key={part.id} className="data-row part-columns" onClick={() => openPart(part)}>
                    <span className="primary-cell">
                      {thumbnails && <span className="part-thumb">{part.name.slice(0, 2).toUpperCase()}</span>}
                      <strong>{part.name}</strong>
                    </span>
                    <span>{part.category}</span><span>{part.storage}</span><span>{part.projects}</span><span>{part.docs}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
}

function PartPage({ part, back }) {
  const selected = part || parts[0];
  return (
    <>
      <PageHeader title={selected.name} back={back}>
        <button>Edit Part</button>
        <button className="icon-button" title="More part actions">⋮</button>
      </PageHeader>
      <div className="detail-grid">
        <div>
          <section className="part-summary">
            <div className="part-hero">ESP32</div>
            <dl><dt>Category</dt><dd>{selected.category}</dd><dt>Storage</dt><dd>{selected.storage}</dd><dt>Stock</dt><dd>{selected.stock}</dd><dt>Used in</dt><dd>{selected.projects} projects</dd></dl>
          </section>
          <section className="content-section"><h2>Notes</h2><p>Development board with Wi-Fi, Bluetooth LE, USB-C, 8 MB flash, and 8 MB PSRAM. Used for rapid prototyping and firmware development.</p></section>
          <section className="content-section"><h2>Spec Summary</h2><ul className="simple-list"><li>Dual-core 32-bit processor up to 240 MHz</li><li>Wi-Fi 802.11 b/g/n and Bluetooth LE 5</li><li>USB-C power and programming</li><li>3.3 V logic, 45 GPIO</li></ul></section>
        </div>
        <div>
          <section className="content-section"><h2>Documents</h2><ul className="file-list"><li><strong>ESP32-S3 Datasheet.pdf</strong><span>PDF</span></li><li><strong>Pinout Reference.pdf</strong><span>PDF</span></li><li><strong>Setup Guide.pdf</strong><span>PDF</span></li></ul></section>
          <section className="content-section"><h2>Project Usage</h2><ul className="usage-list"><li><span>Weather Station</span><span>3</span><em>Active</em></li><li><span>Smart Home Hub</span><span>2</span><em>Active</em></li><li><span>LoRa Sensor Node</span><span>2</span><em>Completed</em></li></ul></section>
          <section className="preview-block"><span>PDF preview</span><strong>ESP32-S3 Datasheet</strong><p>Technical reference and pin definitions</p></section>
        </div>
      </div>
    </>
  );
}

function TrackedPage() {
  const rows = [['Datasheets', '.pdf', 'PDF viewer'], ['Firmware', '.ino, .cpp, .h', 'Text viewer'], ['Drawings', '.dxf, .dwg', 'CAD preview'], ['3D Models', '.stl, .step', 'Model preview'], ['PCB BOM', '.csv, .xlsx', 'Spreadsheet']];
  return (
    <>
      <PageHeader title="Tracked Files Settings"><button>Save</button></PageHeader>
      <div className="settings-canvas">
        <section className="settings-grid">
          <div><h2>Retention</h2><label>Keep revisions <select><option>Last 12</option></select></label><label>Retention mode <select><option>Last-N</option></select></label></div>
          <div><h2>Capture</h2><Toggle checked onChange={() => {}} label="Track linked files" /><Toggle checked={false} onChange={() => {}} label="Delay capture" /></div>
        </section>
        <section className="content-section"><div className="section-heading"><h2>Tracked File Types</h2><button className="secondary">Add file type</button></div>
          <div className="tracker-list">{rows.map((row, index) => <div key={row[0]}><span className={`swatch swatch-${index % 2}`} /><strong>{row[0]}</strong><span>{row[1]}</span><span>{row[2]}</span><button className="icon-button">⋮</button></div>)}</div>
        </section>
        <section className="content-section"><h2>Color Preview</h2><div className="color-preview"><strong>AT24C512C-Datasheet.pdf</strong><strong className="green">firmware_v2.1.0.ino</strong><strong>Assembly-Top.dwg</strong><strong className="green">Enclosure.step</strong></div></section>
      </div>
    </>
  );
}

function NetworkPage() {
  return (
    <>
      <PageHeader title="Network & Sync" />
      <div className="settings-canvas">
        <section className="content-section">
          <div className="section-heading"><h2>Multi-Computer Setup</h2><button>Generate Pairing Code</button></div>
          <div className="device-row"><strong>Workshop PC</strong><span>Host</span><em>Connected</em></div>
          <div className="device-row"><strong>Office Laptop</strong><span>Client</span><em>Connected</em></div>
        </section>
        <section className="content-section lan-row">
          <div><h2>Local Network Access</h2><Toggle checked onChange={() => {}} label="Enabled" /></div>
          <div className="qr">▦</div>
          <div><span>Address</span><strong>http://192.168.1.24:8787</strong></div>
        </section>
        <section className="content-section"><h2>Web Login Security</h2><Toggle checked onChange={() => {}} label="Require admin login" /><div className="form-grid"><label>Scope<select><option>Domain access</option></select></label><label>Admin username<input value="admin" readOnly /></label><label>Remember days<input value="30" readOnly /></label><label>Allowed domains<input value="buildbook.example.com" readOnly /></label></div></section>
      </div>
    </>
  );
}

function PlaceholderPage({ title }) {
  return <><PageHeader title={title} /><section className="empty-state"><strong>{title}</strong><span>This page is available for layout exploration.</span></section></>;
}

function App() {
  const [page, setPage] = useState('projects');
  const [project, setProject] = useState(projects[0]);
  const [part, setPart] = useState(parts[0]);
  const [settings, setSettings] = useState(DEFAULTS);
  const [studioOpen, setStudioOpen] = useState(true);
  const [projectsView, setProjectsView] = useState('cards');
  const [partsView, setPartsView] = useState('cards');

  const style = useMemo(() => ({
    '--canvas': settings.canvas,
    '--surface': settings.surface,
    '--text': settings.text,
    '--accent': settings.accent,
    '--success': settings.success,
    '--sidebar-width': `${settings.sidebarWidth}px`,
    '--row-height': `${settings.rowHeight}px`,
    '--radius': `${settings.radius}px`,
    '--space': settings.density === 'compact' ? '16px' : '24px',
  }), [settings]);

  const content = {
    projects: <ProjectsPage view={projectsView} setView={setProjectsView} thumbnails={settings.thumbnails} openProject={(value) => { setProject(value); setPage('project'); }} />,
    project: <ProjectPage project={project} back={() => setPage('projects')} />,
    parts: <PartsPage view={partsView} setView={setPartsView} thumbnails={settings.thumbnails} openPart={(value) => { setPart(value); setPage('part'); }} />,
    part: <PartPage part={part} back={() => setPage('parts')} />,
    tracked: <TrackedPage />,
    network: <NetworkPage />,
    completed: <PlaceholderPage title="Completed Projects" />,
    search: <PlaceholderPage title="Search" />,
    imports: <PlaceholderPage title="Imports" />,
    settings: <PlaceholderPage title="Settings" />,
  }[page];

  return (
    <div className={`prototype density-${settings.density} sections-${settings.sectionStyle}`} style={style}>
      <AppSidebar page={page} setPage={setPage} width={settings.sidebarWidth} />
      <main className="app-main">{content}</main>
      {!studioOpen && <button className="studio-launch" onClick={() => setStudioOpen(true)}>Layout Studio</button>}
      {studioOpen && <Studio settings={settings} setSettings={setSettings} onClose={() => setStudioOpen(false)} />}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
