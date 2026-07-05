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

function Studio({ settings, setSettings, onClose, openDialog }) {
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

      <section>
        <h3>Review States</h3>
        <div className="studio-review-actions">
          <button className="secondary" onClick={() => openDialog('states')}>Loading & Errors</button>
          <button className="secondary" onClick={() => openDialog('conflict')}>Sync Conflict</button>
        </div>
      </section>

      <footer>
        <button className="secondary" onClick={() => setSettings(DEFAULTS)}>Reset</button>
        <button onClick={copySettings}>Copy settings</button>
      </footer>
    </aside>
  );
}

function AppSidebar({ page, setPage, width }) {
  const settingsOpen = ['workspace', 'template', 'tracked', 'theme', 'maintenance', 'network'].includes(page);
  const workspaceOpen = ['workspace', 'template', 'tracked', 'theme'].includes(page);
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
        <button className={settingsOpen ? 'active' : ''} onClick={() => setPage('workspace')}>Settings</button>
        {settingsOpen && (
          <>
            <button className={`settings-sub-nav ${workspaceOpen ? 'active' : ''}`} onClick={() => setPage('workspace')}>Workspace Setup</button>
            <button className={`settings-sub-nav ${page === 'maintenance' ? 'active' : ''}`} onClick={() => setPage('maintenance')}>Maintenance</button>
            <button className={`settings-sub-nav ${page === 'network' ? 'active' : ''}`} onClick={() => setPage('network')}>Network & Sync</button>
          </>
        )}
      </nav>
      <div className="sidebar-status">Saved</div>
    </aside>
  );
}

function PageHeader({ title, subtitle, children, back }) {
  return (
    <header className="page-header">
      <div className="title-row">
        {back && <button className="icon-button" title="Go back" onClick={back}>←</button>}
        <div className="page-header-copy">
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
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

function ProjectsPage({ openProject, thumbnails, view, setView, openDialog }) {
  return (
    <>
      <PageHeader title="Projects">
        <input className="search-input" placeholder="Search projects..." />
        <div className="segments">
          <button className="active">Open</button><button>All</button><button>Active</button><button>Waiting</button>
        </div>
        <ViewToggle value={view} onChange={setView} />
        <button className="secondary" onClick={() => openDialog('import-project')}>Import Project</button>
        <button onClick={() => openDialog('new-project')}>New Project</button>
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

function CompletedProjectsPage({ openProject, thumbnails }) {
  const completed = [
    { ...projects[3], name: 'LoRa Field Sensor', status: 'Completed', updated: 'Apr 18', progress: '11/11 (100%)' },
    { ...projects[1], name: 'Garden Weather Station', status: 'Completed', updated: 'Mar 30', progress: '14/14 (100%)' },
    { ...projects[4], name: 'Workshop Status Clock', status: 'Completed', updated: 'Feb 9', progress: '10/10 (100%)' },
  ];
  return (
    <>
      <PageHeader title="Completed Projects" subtitle="Finished build records kept for reference." />
      <section className="page-section">
        <div className="section-heading"><h2>Completed Projects</h2><span>{completed.length} projects</span></div>
        <div className="mock-project-grid">
          {completed.map((project) => (
            <button key={project.name} className="mock-project-card" onClick={() => openProject(project)}>
              <div className="mock-project-image">{thumbnails ? <img src={project.image} alt="" /> : <span>Project</span>}<em>{project.status}</em></div>
              <div className="mock-project-body"><strong>{project.name}</strong><small>Completed {project.updated}</small><div className="mock-tags"><span>Design</span><span>Build</span><span>Test</span></div><div className="mock-meta"><span>{project.parts} parts</span><span>{project.progress}</span><span>{project.files} files</span></div></div>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

function SearchPage({ setPage }) {
  const [query, setQuery] = useState('power');
  const [previewState, setPreviewState] = useState('results');
  const groups = [
    ['Projects', [['Workbench Power Monitor', 'Active project', 'projects']]],
    ['Parts', [['INA219 Current Sensor', 'Sensors / Current · Organizer A, Bin 4', 'parts'], ['Isolated AC Sensor', 'Sensors / Voltage · Drawer 2', 'parts']]],
    ['Project Files', [['Power Monitor Firmware v12.ino', 'Workbench Power Monitor · Firmware · latest', 'projects'], ['Power Board Schematic.pdf', 'Workbench Power Monitor · Drawings', 'projects']]],
    ['Part Documents', [['INA219 Datasheet.pdf', 'INA219 Current Sensor · PDF', 'parts']]],
    ['Imports', [['24V Power Supply', 'DigiKey_Order_0618.csv · draft', 'imports']]],
  ];
  return (
    <>
      <PageHeader title="Search" subtitle="Find projects, parts, datasheets, project files, and import drafts.">
        <div className="segments"><button className={previewState === 'results' ? 'active' : ''} onClick={() => setPreviewState('results')}>Results</button><button className={previewState === 'empty' ? 'active' : ''} onClick={() => setPreviewState('empty')}>Empty</button><button className={previewState === 'error' ? 'active' : ''} onClick={() => setPreviewState('error')}>Error</button></div>
      </PageHeader>
      <div className="search-page">
        <div className="search-hero"><input value={previewState === 'empty' ? '' : query} onChange={(event) => { setQuery(event.target.value); setPreviewState(event.target.value ? 'results' : 'empty'); }} placeholder="Search by part, project, file, datasheet, storage location..." />{previewState !== 'empty' && <button className="secondary" onClick={() => setPreviewState('empty')}>Clear</button>}</div>
        {previewState === 'empty' && <section className="empty-panel">Start typing to search across the app.</section>}
        {previewState === 'error' && <section className="state-banner error-state"><strong>Search unavailable</strong><span>The workspace index could not be read. Try again after BuildBook finishes loading.</span><button className="secondary" onClick={() => setPreviewState('results')}>Retry</button></section>}
        {previewState === 'results' && <><p className="muted-count">7 results for "{query}"</p><div className="search-results-grid">{groups.map(([title, rows]) => <section className="search-result-section" key={title}><div className="section-heading"><h2>{title}</h2><span>{rows.length}</span></div>{rows.map(([name, detail, page]) => <button key={name} onClick={() => setPage(page)}><strong>{name}</strong><span>{detail}</span></button>)}</section>)}</div></>}
      </div>
    </>
  );
}

function ImportsPage({ openDialog }) {
  const batches = [
    ['DigiKey_Order_0618.csv', 'Jun 18, 2026', '4 draft / 12 total'],
    ['Mouser_Invoice_8841.pdf', 'Jun 3, 2026', '0 draft / 8 total'],
    ['LCSC_cart_export.csv', 'May 22, 2026', '2 draft / 6 total'],
  ];
  return (
    <>
      <PageHeader title="Imports" subtitle="Turn online order exports into draft parts for the library." />
      <div className="imports-page">
        <section className="upload-card"><div><h2>Import CSV or PDF</h2><p>Upload supplier exports, invoices, or order files to create draft parts.</p></div><button>Import File</button></section>
        <div className="imports-layout">
          <aside className="import-batches"><h2>Batches</h2>{batches.map(([name, date, count], index) => <button className={index === 0 ? 'active' : ''} key={name} onClick={() => openDialog('import-batch')}><strong>{name}</strong><span>{date}</span><small>{count}</small></button>)}</aside>
          <section className="import-summary"><h2>Import Review</h2><p>Select a batch to review categories, matches, and actions before applying it.</p><div className="import-summary-stats"><div><strong>3</strong><span>Import batches</span></div><div><strong>6</strong><span>Draft parts</span></div><div><strong>20</strong><span>Imported parts</span></div></div><button onClick={() => openDialog('import-batch')}>Review Selected Batch</button></section>
        </div>
      </div>
    </>
  );
}

function MockRichEditor({ children }) {
  return (
    <div className="mock-rich-editor">
      <div className="mock-rich-toolbar">
        <button className="secondary">B</button>
        <button className="secondary"><em>I</em></button>
        <button className="secondary">H2</button>
        <button className="secondary">List</button>
        <button className="secondary">Link</button>
        <button className="secondary">Image</button>
      </div>
      <div className="mock-rich-area">{children}</div>
    </div>
  );
}

function ProjectOverviewMock() {
  return (
    <div className="mock-dashboard-grid">
      <article className="mock-notes-card">
        <div className="mock-note-tabs">
          <button className="active">Project Notes</button>
          <button>Electrical</button>
          <button>Firmware</button>
          <button className="icon-button" title="Add note sheet">+</button>
        </div>
        <MockRichEditor>
          <h3>Workbench power monitor</h3>
          <p>Monitor AC and DC output from the bench supply using an ESP32-S3, isolated voltage sensing, and an INA219 current sensor.</p>
          <p><strong>Decision:</strong> Keep the display and logging firmware independent so the SD card can be disabled during calibration.</p>
          <ul><li>OLED address: 0x3C</li><li>Current shunt: 0.1 ohm</li><li>Log interval: 500 ms</li></ul>
        </MockRichEditor>
      </article>
      <div className="mock-overview-side">
        <article>
          <h3>Checklist</h3>
          <div className="mock-check-toolbar"><input placeholder="Add checklist item" /><button>Add</button><button className="secondary">Show Completed</button></div>
          <label className="mock-check-line"><input type="checkbox" checked readOnly /><span>Define measurement ranges</span></label>
          <label className="mock-check-line"><input type="checkbox" checked readOnly /><span>Design sensor PCB</span></label>
          <label className="mock-check-line"><input type="checkbox" /><span>Calibrate voltage channel</span></label>
          <label className="mock-check-line"><input type="checkbox" /><span>Finish enclosure labels</span></label>
        </article>
        <article>
          <h3>Latest Files</h3>
          {[
            ['3D Models', 'Enclosure Model.step'],
            ['Firmware', 'Firmware v12.ino'],
            ['Drawings', 'Wiring Diagram.pdf'],
          ].map(([type, name]) => (
            <div className="mock-latest" key={name}>
              <strong>{type}</strong>
              <span>{name}</span>
              <div><button className="secondary">Open</button><button className="secondary">Download</button></div>
            </div>
          ))}
        </article>
      </div>
    </div>
  );
}

function ProjectInstructionsMock() {
  return (
    <div className="mock-instructions-layout">
      <section className="mock-project-panel">
        <h3>Intro</h3>
        <MockRichEditor>
          <p>Build a compact monitor for the workbench power supply. Disconnect mains power before opening the supply enclosure and verify isolation before connecting USB.</p>
        </MockRichEditor>
      </section>
      <section className="mock-project-panel">
        <h3>Parts List</h3>
        <div className="mock-instruction-parts">
          {parts.slice(0, 5).map((part, index) => <div key={part.id}><span>{part.name}</span><strong>Qty {index === 3 ? 4 : 1}</strong></div>)}
        </div>
        <div className="mock-instruction-add"><select><option>Link part from library</option></select><input type="number" value="1" readOnly /><button>Link Part</button></div>
      </section>
      <section className="mock-project-panel wide">
        <div className="section-heading"><h3>Steps</h3><button>Add Another Step</button></div>
        <div className="mock-step-list">
          {[
            ['Step 1', 'Assemble the sensor PCB', 'Fit the INA219, isolation components, and terminal blocks. Inspect polarity before soldering.'],
            ['Step 2', 'Install the display', 'Mount the OLED behind the front panel and route the I2C cable away from the AC input.'],
            ['Step 3', 'Flash and calibrate', 'Upload the firmware, connect a reference meter, and record calibration factors.'],
          ].map(([number, title, body], index) => (
            <article className="mock-step" key={number}>
              <span>{number}</span>
              <input value={title} readOnly />
              <select><option>{index === 0 ? 'PCB assembly.jpg' : index === 1 ? 'Front panel.jpg' : 'No linked photo'}</option></select>
              <MockRichEditor><p>{body}</p></MockRichEditor>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function ProjectPhotosMock() {
  const photoSources = ['/sample%20images/Project%20overview.PNG', '/sample%20images/Project%20Files.PNG', '/sample%20images/Parts%20Library.PNG'];
  return (
    <div className="mock-photo-layout">
      <section className="mock-project-panel mock-folder-panel">
        <h3>Photo Folders</h3>
        <div className="mock-inline-entry"><input placeholder="Folder name" /><button>Add</button></div>
        <button>Assembly (3)</button>
        <button className="secondary">Enclosure (2)</button>
        <button className="secondary">Testing (1)</button>
      </section>
      <section className="mock-project-panel">
        <div className="section-heading"><h3>Assembly</h3><button>Upload Photos</button></div>
        <div className="mock-photo-grid">
          {['Sensor PCB installed', 'Display wiring', 'First power-up', 'Enclosure fit check', 'Calibration setup', 'Completed assembly'].map((name, index) => (
            <article className="mock-photo-card" key={name}>
              <img src={photoSources[index % photoSources.length]} alt="" />
              <strong>{name}</strong>
              <textarea value={index % 2 ? 'Reference photo for build instructions.' : 'Check cable routing before closing enclosure.'} readOnly />
              <div><button className="secondary">Download</button><button className="secondary">Markup</button></div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function ProjectPartsMock() {
  return (
    <div className="mock-project-parts">
      <div>
        <div className="section-toolbar"><button>Link Part</button></div>
        <div className="mock-linked-parts">
          {parts.map((part) => (
            <button className="mock-linked-part" key={part.id}>
              <span>{part.name.slice(0, 2).toUpperCase()}</span>
              <strong>{part.name}</strong>
              <small>{part.category}</small>
              <em>{part.storage}</em>
            </button>
          ))}
        </div>
      </div>
      <section className="mock-project-panel mock-build-parts">
        <h2>Build Parts</h2>
        {parts.map((part, index) => (
          <label key={part.id}><span>{part.name}</span><input type="number" value={index === 3 ? 4 : 1} readOnly /></label>
        ))}
      </section>
    </div>
  );
}

function ProjectFilesMock() {
  const [previewState, setPreviewState] = useState('code');
  const groups = [
    ['Firmware', [['Firmware v12.ino', 'Latest'], ['Firmware v11.ino', 'Older'], ['Firmware v10.ino', 'Older']]],
    ['3D Models', [['Enclosure Model.step', 'Latest'], ['Enclosure Model v4.step', 'Older'], ['Enclosure Model v3.step', 'Older']]],
    ['Drawings', [['Wiring Diagram.pdf', 'Latest'], ['Wiring Diagram rev2.pdf', 'Older']]],
  ];
  return (
    <div className="mock-files-workspace">
      <div>
        <section className="mock-project-panel mock-upload">
          <div><select><option>Firmware (.ino, .cpp, .h)</option></select><input placeholder="Upload notes" /></div>
          <div><button className="secondary">Upload File</button><button className="secondary">Upload Folder</button><button className="secondary">Link File</button><button className="secondary">Link Folder</button><button>Load File</button></div>
        </section>
        {groups.map(([group, files]) => (
          <section className="mock-project-panel mock-file-group" key={group}>
            <div className="section-heading"><h3>{group}</h3><button className="secondary">Show all</button></div>
            {files.map(([name, status], index) => (
              <div className="mock-file-row" key={name}>
                <button className="secondary">Open</button>
                <strong>{name}</strong>
                <span>{index ? 'May 2' : 'May 12'}</span>
                <button className={status === 'Latest' ? '' : 'secondary'}>{status}</button>
              </div>
            ))}
          </section>
        ))}
      </div>
      <section className="mock-project-panel mock-file-viewer">
        <div className="section-heading"><h2>File Viewer</h2><div className="view-toggle"><button className="active">Latest Files</button><button>All Files</button></div></div>
        <select value={previewState} onChange={(event) => setPreviewState(event.target.value)}><option value="code">Firmware - Firmware v12.ino</option><option value="pdf">Drawings - Wiring Diagram.pdf</option><option value="sheet">PCB BOM - power-board.csv</option><option value="model">3D Models - Enclosure Model.step</option><option value="empty">No file selected</option><option value="unsupported">Unsupported format</option><option value="error">Preview error</option></select>
        {previewState === 'code' && <div className="mock-code-preview"><span>Firmware</span><strong>Firmware v12.ino</strong><pre>{`void setup() {\n  display.begin(0x3C);\n  sensors.calibrate();\n}\n\nvoid loop() {\n  samplePower();\n  writeLog();\n}`}</pre></div>}
        {previewState === 'pdf' && <div className="mock-document-preview"><span>PDF · Page 1 of 3</span><strong>Wiring Diagram</strong><div className="diagram-lines"><i /><i /><i /><i /></div></div>}
        {previewState === 'sheet' && <div className="mock-sheet-preview"><div><strong>Reference</strong><strong>Value</strong><strong>Qty</strong></div>{[['U1', 'ESP32-S3', '1'], ['R4', '0.1 ohm', '1'], ['J2', 'Terminal block', '2']].map((row) => <div key={row[0]}>{row.map((cell) => <span key={cell}>{cell}</span>)}</div>)}</div>}
        {previewState === 'model' && <div className="mock-model-preview"><span>STEP preview</span><div>3D</div><strong>Enclosure Model.step</strong></div>}
        {previewState === 'empty' && <div className="mock-preview-state">Choose a latest file to preview.</div>}
        {previewState === 'unsupported' && <div className="mock-preview-state"><strong>Controller Layout.pcbdoc</strong><p>Open this file in its external application.</p><button className="secondary">Open File</button></div>}
        {previewState === 'error' && <div className="mock-preview-state error-state"><strong>Preview unavailable</strong><p>The file could not be read from managed storage.</p><button className="secondary">Retry</button></div>}
      </section>
    </div>
  );
}

function ProjectAiMock() {
  const [view, setView] = useState('chat');
  const [settingsTab, setSettingsTab] = useState('connection');
  const [draftOpen, setDraftOpen] = useState(false);
  return (
    <section className="mock-project-panel mock-ai-panel">
      <div className="section-heading"><div><h2>AI Chat</h2><p>Context is limited to this project and the Parts Library.</p></div><div className="view-toggle"><button className={view === 'chat' ? 'active' : ''} onClick={() => setView('chat')}>Chat</button><button className={view === 'settings' ? 'active' : ''} onClick={() => setView('settings')}>Settings</button></div></div>
      {view === 'chat' && <><div className="mock-chat">
        <div className="mock-message user"><strong>You</strong><p>What should I verify before the first powered test?</p></div>
        <div className="mock-message assistant"><strong>BuildBook AI</strong><p>Verify isolation between the AC input and USB ground, confirm terminal polarity, inspect the current-shunt value, and power the ESP32 from a current-limited supply first.</p><small>Based on Project Notes, Wiring Diagram.pdf, and Step 3.</small></div>
        <div className="mock-message assistant"><strong>BuildBook AI</strong><p>I can add a pre-power checklist item and create a library record for the isolated voltage sensor.</p><div className="ai-draft-summary"><span>2 changes proposed</span><button onClick={() => setDraftOpen(!draftOpen)}>Review and Apply</button></div>{draftOpen && <div className="ai-draft-review"><label><input type="checkbox" defaultChecked />Add checklist item: Verify USB ground isolation</label><label><input type="checkbox" defaultChecked />Create part: ZMPT101B isolated voltage sensor</label><dl><dt>Category</dt><dd>Sensors / Voltage</dd><dt>Project link</dt><dd>Yes, quantity 1</dd><dt>Possible duplicates</dt><dd>None found</dd></dl><div><button className="secondary">Cancel</button><button>Apply Selected</button></div></div>}</div>
      </div><div className="mock-prompt"><textarea placeholder="Ask about this project..." /><button>Send</button></div></>}
      {view === 'settings' && <div className="ai-settings-mock">
        <div className="tabs">{[['connection', 'Connection'], ['access', 'Project Access'], ['memory', 'Memory & Audit']].map(([id, label]) => <button className={settingsTab === id ? 'active' : ''} key={id} onClick={() => setSettingsTab(id)}>{label}</button>)}</div>
        {settingsTab === 'connection' && <div className="ai-form-grid"><label>Connection profile<select><option>Workshop AI</option><option>Local Ollama</option></select></label><label>Provider<select><option>OpenAI</option><option>Anthropic Claude</option><option>Google Gemini</option><option>OpenAI-compatible</option></select></label><label>Profile name<input value="Workshop AI" readOnly /></label><label>Endpoint<input value="https://api.openai.com/v1" readOnly /></label><label>Model<input value="gpt-4.1-mini" readOnly /></label><label>API key<input type="password" value="example-key" readOnly /></label><div className="ai-capabilities"><label><input type="checkbox" defaultChecked />Structured BuildBook tools</label><label><input type="checkbox" defaultChecked />Vision/image input</label><label><input type="checkbox" defaultChecked />Provider web search</label></div><button>Save Connection</button></div>}
        {settingsTab === 'access' && <div className="ai-access-list">{[['Overview', 'Read / write'], ['Instructions', 'Read / write'], ['Photos', 'Read'], ['Project Parts', 'Read / write'], ['Files', 'Read'], ['Parts Library', 'Read'], ['Web Research', 'Enabled']].map(([label, value]) => <label key={label}><span><strong>{label}</strong><small>Access for this project only</small></span><select defaultValue={value}><option>No access</option><option>Read</option><option>Read / write</option><option>Enabled</option></select></label>)}</div>}
        {settingsTab === 'memory' && <div className="ai-memory-mock"><label>Project memory<textarea value="Use current-limited power for first tests. USB ground isolation is mandatory." readOnly /></label><button>Save Memory</button><h3>Recent AI Activity</h3><div><strong>search_project</strong><span>success · Today, 10:14 AM</span></div><div><strong>read_project_section</strong><span>success · Today, 10:14 AM</span></div></div>}
      </div>}
    </section>
  );
}

function ProjectPage({ project, back, openDialog }) {
  const selected = project || projects[0];
  const [projectTab, setProjectTab] = useState('overview');
  return (
    <div className="mock-project-page">
      <button className="mock-back secondary" onClick={back}>Back to projects</button>
      <section className="mock-project-hero">
        <div className="mock-project-hero-image"><img src={selected.image} alt="" /><button className="secondary">Change Image</button></div>
        <div className="mock-project-heading">
          <input value={selected.name} readOnly />
          <div><span className="status-dot">Active</span><select><option>active</option><option>paused</option><option>waiting</option></select></div>
          <p>{selected.parts} linked parts · 8 files · 4 latest files</p>
        </div>
        <div className="mock-hero-actions"><button onClick={() => openDialog('export-project')}>Export Project</button><button className="secondary" onClick={() => openDialog('delete-project')}>Delete</button></div>
      </section>
      <section className="mock-project-tags">
        <h3>Project Tags</h3>
        <div>{['Design', 'Schematic', 'PCB Layout', 'Assembly', 'Programming', 'Testing'].map((tag, index) => <button className={index < 3 ? 'active' : ''} key={tag}>{tag}</button>)}</div>
      </section>
      <button className="mock-configure-tabs secondary" onClick={() => openDialog('project-tabs')}>Configure Tabs</button>
      <div className="tabs">
        {[
          ['overview', 'Overview'],
          ['instructions', 'Instructions'],
          ['photos', 'Photos (6)'],
          ['parts', 'Parts (6)'],
          ['files', 'Files (8)'],
          ['ai', 'AI Chat'],
        ].map(([id, label]) => <button key={id} className={projectTab === id ? 'active' : ''} onClick={() => setProjectTab(id)}>{label}</button>)}
      </div>
      {projectTab === 'overview' && <ProjectOverviewMock />}
      {projectTab === 'instructions' && <ProjectInstructionsMock />}
      {projectTab === 'photos' && <ProjectPhotosMock />}
      {projectTab === 'parts' && <ProjectPartsMock />}
      {projectTab === 'files' && <ProjectFilesMock />}
      {projectTab === 'ai' && <ProjectAiMock />}
    </div>
  );
}

function PartsPage({ openPart, thumbnails, view, setView, openDialog }) {
  return (
    <>
      <PageHeader title="Parts Library">
        <input className="search-input" placeholder="Search parts..." />
        <ViewToggle value={view} onChange={setView} />
        <button className="secondary" onClick={() => openDialog('categories')}>Edit Categories</button>
        <button onClick={() => openDialog('new-part')}>New Part</button>
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

function PartPage({ part, back, openDialog }) {
  const selected = part || parts[0];
  return (
    <>
      <PageHeader title={selected.name} back={back}>
        <button onClick={() => openDialog('edit-part')}>Edit Part</button>
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

function SettingsSection({ title, description, actions, children, danger = false }) {
  return (
    <section className={`settings-section-card ${danger ? 'danger-settings' : ''}`}>
      <div className="settings-section-row">
        <div><h2>{title}</h2><p>{description}</p></div>
        {actions && <div className="settings-actions">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

function SettingsWorkspacePage({ setPage }) {
  return (
    <>
      <PageHeader title="Settings" subtitle="Manage workspace defaults, appearance, and system preferences." />
      <div className="settings-page-content">
        <SettingsSection title="Project Template" description="Configure default tabs, step tags, and checklist starters for new projects." actions={<button className="secondary" onClick={() => setPage('template')}>Edit Template</button>} />
        <SettingsSection title="Tracked Files Settings" description="Configure tracked file types, revision retention, linked-file snapshots, and timing." actions={<button className="secondary" onClick={() => setPage('tracked')}>Open Editor</button>} />
        <SettingsSection title="Color Theme" description="Adjust colors, preview theme tokens, or export a portable theme file." actions={<><button className="secondary">Export</button><button className="secondary" onClick={() => setPage('theme')}>Open Editor</button></>} />
      </div>
    </>
  );
}

function SettingsTemplatePage({ back }) {
  const [tabs, setTabs] = useState(['Overview', 'Instructions', 'Photos', 'Parts', 'Files']);
  const stepTags = ['Design', 'Schematic', 'PCB Layout', 'Assembly', 'Programming', 'Testing'];
  const checklist = ['Define requirements', 'Create first prototype', 'Review power and safety', 'Document final assembly'];
  const toggleTab = (tab) => setTabs((current) => current.includes(tab) ? current.filter((item) => item !== tab) : [...current, tab]);
  return (
    <>
      <PageHeader title="Project Template" subtitle="Defaults copied into each new project." back={back}><button className="secondary" onClick={back}>Close</button></PageHeader>
      <div className="settings-page-content template-settings-layout">
        <section className="template-preview-card">
          <div className="template-image">Project<span>Active</span></div>
          <div><strong>Template Preview</strong><div className="tag-strip">{stepTags.slice(0, 5).map((tag) => <span key={tag}>{tag}</span>)}</div><small>{checklist.length} default tasks</small></div>
        </section>
        <div className="template-editor-grid">
          <section className="settings-editor-section">
            <h2>Step Buttons</h2>
            <div className="inline-entry"><input placeholder="New step" /><button>Add</button></div>
            <div className="tag-strip">{stepTags.map((tag) => <button className="tag-button active" key={tag}>{tag}</button>)}</div>
          </section>
          <section className="settings-editor-section">
            <h2>Default Checklist</h2>
            <div className="inline-entry"><input placeholder="Default task" /><button>Add</button></div>
            {checklist.map((item) => <div className="settings-list-row" key={item}><span>{item}</span><button className="secondary">Delete</button></div>)}
          </section>
          <section className="settings-editor-section">
            <h2>Default Project Tabs</h2>
            <p>New projects copy these tabs. AI Chat is off by default.</p>
            <div className="project-tab-options">
              {['Overview', 'Instructions', 'Photos', 'Parts', 'Files', 'AI Chat'].map((tab) => <label key={tab}><input type="checkbox" checked={tabs.includes(tab)} onChange={() => toggleTab(tab)} />{tab}</label>)}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function SettingsTrackedPage({ back }) {
  const rows = [['Datasheets', '.pdf'], ['Firmware', '.ino, .cpp, .h'], ['Drawings', '.dxf, .dwg'], ['3D Models', '.stl, .step'], ['PCB BOM', '.csv, .xlsx']];
  return (
    <>
      <PageHeader title="Tracked Files Settings" subtitle="Revision behavior and file groups used by project workspaces." back={back}><button className="secondary" onClick={back}>Cancel</button><button onClick={back}>Save</button></PageHeader>
      <div className="settings-page-content">
        <section className="settings-grid">
          <div><h2>Retention</h2><label>Stored revisions <input type="number" value="12" readOnly /></label><label>Retention mode <select defaultValue="last"><option value="last">Last N revisions</option><option>Hybrid trim</option></select></label><Toggle checked={false} onChange={() => {}} label="Save all revisions" /></div>
          <div><h2>Capture</h2><Toggle checked onChange={() => {}} label="Track linked files and folders" /><Toggle checked={false} onChange={() => {}} label="Delay repeat revision checks" /><label>Delay minutes <input type="number" value="10" readOnly /></label></div>
        </section>
        <section className="settings-editor-section">
          <div className="section-heading"><div><h2>Tracked File Types</h2><p>Drag to reorder the groups shown in project file lists.</p></div></div>
          <div className="tracker-add-row"><input placeholder="Tracker name" /><input placeholder=".pdf,.dxf" /><button>Add</button></div>
          <div className="tracker-edit-list">{rows.map(([name, extensions]) => <div key={name}><span className="drag-handle">::</span><input value={name} readOnly /><input value={extensions} readOnly /><button className="secondary">Delete</button></div>)}</div>
        </section>
        <section className="settings-editor-section">
          <h2>Tracked File Storage by Project</h2>
          <div className="storage-project-row"><div><strong>Workbench Power Monitor</strong><span>18.4 MB</span></div><span>Firmware v12.ino</span><span>Enclosure Model.step</span></div>
          <div className="storage-project-row"><div><strong>Weather Station</strong><span>12.7 MB</span></div><span>Controller PCB.kicad_pcb</span><span>Assembly Drawing.pdf</span></div>
        </section>
      </div>
    </>
  );
}

function SettingsThemePage({ settings, setSettings, back }) {
  const fields = [
    ['canvas', 'Canvas', ['Muted canvas', 'Input background']],
    ['surface', 'Surface', ['Raised surface', 'Hover surface']],
    ['text', 'Text & dividers', ['Muted text', 'Borders']],
    ['accent', 'Action & links', ['Selected row', 'Focus ring']],
    ['success', 'Active & success', ['Success fill', 'Active tag']],
  ];
  return (
    <>
      <PageHeader title="Theme Editor" subtitle="Five editable colors drive the rest of the interface." back={back}>
        <button className="secondary">Import</button><button className="secondary">Export</button><button onClick={back}>Save Theme</button>
      </PageHeader>
      <div className="settings-page-content theme-settings-page">
        <section className="theme-live-preview">
          <aside><strong>BuildBook</strong><span>Projects</span><span className="active">Parts Library</span><span>Settings</span></aside>
          <main>
            <div className="section-heading"><div><h2>Parts Library</h2><p>Preview of the selected theme colors.</p></div><button>New Part</button></div>
            <div className="tag-strip"><span>Robotics</span><span>Active</span><span>Paused</span><span>Waiting</span></div>
            <div className="theme-preview-items"><article><strong>Nema Motor</strong><span>Motors & Motion</span></article><article><strong>Earthquake PCB</strong><span>Prototyping & Tools</span></article></div>
          </main>
        </section>
        <section className="settings-editor-section theme-token-editor">
          <div className="section-heading"><div><h2>Theme Colors</h2><p>Editable colors are on the left; colors derived from each value are aligned to the right.</p></div><button className="secondary" onClick={() => setSettings(DEFAULTS)}>Reset Original</button></div>
          {fields.map(([key, label, derived]) => (
            <div className="theme-token-row" key={key}>
              <div className="theme-token-main"><input type="color" value={settings[key]} onChange={(event) => setSettings((current) => ({ ...current, [key]: event.target.value }))} /><label>{label}<input value={settings[key].toUpperCase()} readOnly /></label></div>
              <div className="theme-token-derived">{derived.map((name, index) => <div key={name}><i style={{ background: index ? settings[key] : `color-mix(in srgb, ${settings[key]} 60%, ${settings.canvas})` }} /><span>{name}</span></div>)}</div>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}

function SettingsMaintenancePage({ openDialog }) {
  const [scanVisible, setScanVisible] = useState(true);
  const [tray, setTray] = useState(true);
  return (
    <>
      <PageHeader title="Settings" subtitle="Manage workspace defaults, appearance, and system preferences." />
      <div className="settings-page-content">
        <SettingsSection title="Software Updates" description="Check GitHub Releases for a newer BuildBook installer." actions={<button className="secondary">Check for Updates</button>}><p className="settings-note">BuildBook v0.4.0-test.13 is installed.</p></SettingsSection>
        <SettingsSection title="Backup and Restore" description="Export a portable zip of project data and assets, or restore from a prior backup." actions={<><button className="secondary" onClick={() => openDialog('restore')}>Restore</button><button className="secondary">Export Backup</button></>} />
        <SettingsSection title="Storage Cleanup" description="Find orphaned files and thumbnails no longer referenced by any project." actions={<><button className="secondary" onClick={() => setScanVisible(!scanVisible)}>Scan Storage</button>{scanVisible && <button>Delete Selected</button>}</>}>
          {scanVisible && <div className="storage-scan">
            <p>428 stored files, 1.8 GB total. 3 orphan files, 14 MB recoverable.</p>
            <div className="orphan-toolbar"><button className="secondary">Select Visible</button><button className="secondary">Select None</button><span>2 selected</span></div>
            {[['old-enclosure-v2.step', '8.2 MB', true], ['board-preview.png', '4.1 MB', true], ['temp-export.pdf', '1.7 MB', false]].map(([name, size, checked]) => <label className="orphan-row" key={name}><input type="checkbox" defaultChecked={checked} /><span>{name}</span><small>{size}</small><small>6/28/2026</small><button className="secondary">Open</button></label>)}
          </div>}
        </SettingsSection>
        <SettingsSection title="Background Operation" description="Keep BuildBook available from the tray when the desktop window is closed." actions={<Toggle checked={tray} onChange={setTray} label="Keep running in tray" />} />
        <SettingsSection danger title="Reset BuildBook" description="Delete managed uploads and restore all projects, parts, categories, and settings to first-install defaults." actions={<button className="danger-button" onClick={() => openDialog('full-reset')}>Full Reset</button>} />
      </div>
    </>
  );
}

function QrMock() {
  const dark = new Set([0, 1, 2, 3, 4, 5, 6, 8, 12, 14, 16, 18, 20, 22, 24, 25, 26, 27, 28, 30, 32, 35, 37, 39, 40, 41, 42, 43, 44, 46, 48, 50, 52, 54, 56, 57, 58, 59, 60, 61, 62]);
  return <div className="qr-mock" aria-label="Example QR code">{Array.from({ length: 64 }, (_, index) => <i className={dark.has(index) ? 'dark' : ''} key={index} />)}</div>;
}

function SettingsNetworkPage() {
  const [mode, setMode] = useState('client');
  const [localEnabled, setLocalEnabled] = useState(true);
  const hostControlled = mode === 'client';
  return (
    <>
      <PageHeader title="Settings" subtitle="Manage workspace defaults, appearance, and system preferences.">
        <div className="segments preview-state"><button className={mode === 'local' ? 'active' : ''} onClick={() => setMode('local')}>Local</button><button className={mode === 'host' ? 'active' : ''} onClick={() => setMode('host')}>Host</button><button className={mode === 'client' ? 'active' : ''} onClick={() => setMode('client')}>Client</button></div>
      </PageHeader>
      <div className="settings-page-content">
        <SettingsSection title="Multi-Computer Setup" description="Use this installation locally, make it the authoritative host, or pair it with another BuildBook host." actions={<span className="mode-badge">{mode}</span>}>
          <div className="computer-name-row"><label>This computer<input value={mode === 'host' ? 'Workshop PC' : 'Office Laptop'} readOnly /></label><button className="secondary">Save Name</button><span>Device ID: BB-42F8-A19C</span></div>
          {mode === 'client' && <div className="connected-host-summary"><div><strong>Connected Host</strong><span>http://192.168.1.24:8788</span></div><div className="settings-actions"><button className="secondary">Prefetch Client Cache</button><button className="secondary">Refresh Status</button><button className="danger-button">Unlink From Host</button></div><p>Network access and web login settings are controlled by the host computer.</p></div>}
          {mode === 'host' && <><div className="sync-mode-actions"><button>Generate Pairing Code</button><button className="secondary" onClick={() => setMode('local')}>Use Standalone Local Data</button></div><div className="device-row"><strong>Office Laptop</strong><span>Last seen today, 9:42 AM</span><button className="danger-button">Revoke</button></div></>}
          {mode === 'local' && <><div className="sync-mode-actions"><button onClick={() => setMode('host')}>Create Host from This Computer</button><button className="secondary">Find Hosts</button></div><div className="connect-host-row"><label>Host address<input value="http://192.168.1.24:8788" readOnly /></label><label>Pairing code<input placeholder="8 digit code from host" /></label><button onClick={() => setMode('client')}>Connect</button></div></>}
          <div className="sync-dashboard"><div><strong>Sync Status</strong><span>{mode === 'client' ? 'Connected cache' : mode === 'host' ? 'Host ready' : 'Standalone'}</span></div><div><strong>{mode === 'client' ? 'Client Cache' : 'Paired Devices'}</strong><span>{mode === 'client' ? '146 files, 684 MB' : mode === 'host' ? '1 active, 0 revoked' : 'None'}</span></div><div><strong>Last sync</strong><span>{mode === 'local' ? 'Not applicable' : 'Today, 9:42 AM'}</span></div></div>
        </SettingsSection>
        <SettingsSection title="Local Network Access" description="Serve BuildBook to devices on your Wi-Fi. Leave off unless actively in use." actions={!hostControlled && <button className={localEnabled ? 'danger-button' : 'secondary'} onClick={() => setLocalEnabled(!localEnabled)}>{localEnabled ? 'Turn Off' : 'Turn On'}</button>}>
          {hostControlled && <div className="client-access-preview"><span>Host access</span><div className="segments"><button className={localEnabled ? 'active' : ''} onClick={() => setLocalEnabled(true)}>Enabled</button><button className={!localEnabled ? 'active' : ''} onClick={() => setLocalEnabled(false)}>Disabled</button></div></div>}
          {localEnabled ? <div className="lan-access-box"><QrMock /><div><strong>Address</strong><p>http://192.168.1.24:8787</p></div></div> : <p className="settings-note">{hostControlled ? 'Local access is disabled on the host computer.' : 'Local network access is off.'}</p>}
          {!hostControlled && <div className="lan-controls"><label>Port<input value="8787" readOnly /></label><label><input type="checkbox" defaultChecked />Require access token</label><button className="secondary">Regenerate Access Code</button></div>}
        </SettingsSection>
        <SettingsSection title="Web Login Security" description="Require an admin login for browser access when using a domain or reverse proxy." actions={<Toggle checked onChange={() => {}} label="Require admin login" />}>
          <div className="form-grid"><label>Apply login to<select defaultValue="domain"><option value="domain">Domain/proxy access only</option><option>All browser access</option></select></label><label>Admin username<input value="admin" readOnly /></label><label>Remember device days<input value="30" readOnly /></label><label>Allowed domains<input value="buildbook.example.com, *.tailnet.ts.net" readOnly /></label></div>
          {hostControlled ? <p className="settings-note">Password changes are only available in the host desktop app.</p> : <div className="password-row"><label>New password<input type="password" value="examplepass" readOnly /></label><label>Confirm password<input type="password" value="examplepass" readOnly /></label><button className="secondary">Save Password</button></div>}
        </SettingsSection>
      </div>
    </>
  );
}

function MockDialog({ title, subtitle, onClose, children, footer, className = '' }) {
  return (
    <div className="mock-modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`mock-modal ${className}`}>
        <header><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button secondary" title="Close" onClick={onClose}>×</button></header>
        <div className="mock-modal-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </section>
    </div>
  );
}

function WorkflowDialog({ type, onClose }) {
  if (!type) return null;
  if (type === 'new-project') return <MockDialog title="New Project" onClose={onClose} className="compact-workflow" footer={<><button className="secondary" onClick={onClose}>Cancel</button><button onClick={onClose}>Create</button></>}><label>Project name<input autoFocus placeholder="Project name" /></label></MockDialog>;
  if (type === 'delete-project') return <MockDialog title="Delete Project" onClose={onClose} className="compact-workflow" footer={<><button className="secondary" onClick={onClose}>Cancel</button><button className="danger-button" onClick={onClose}>Delete Project</button></>}><p>Delete <strong>Workbench Power Monitor</strong>? Linked library parts remain available.</p></MockDialog>;
  if (type === 'full-reset') return <MockDialog title="Reset BuildBook" onClose={onClose} className="compact-workflow" footer={<><button className="secondary" onClick={onClose}>Cancel</button><button className="danger-button" onClick={onClose}>Delete All and Reset</button></>}><p>This permanently deletes uploaded BuildBook data and resets the app to defaults. Linked external files are not deleted.</p><label>Type delete all to confirm<input placeholder="delete all" /></label></MockDialog>;
  if (type === 'restore') return <MockDialog title="Restore Backup" subtitle="buildbook-backup-2026-06-28.zip" onClose={onClose} className="compact-workflow" footer={<><button className="secondary" onClick={onClose}>Cancel</button><button onClick={onClose}>Restore Backup</button></>}><div className="restore-summary"><div><strong>5</strong><span>Projects</span></div><div><strong>1,248</strong><span>Parts</span></div><div><strong>1.7 GB</strong><span>Managed files</span></div></div><p>Current workspace data will be replaced by this backup.</p></MockDialog>;
  if (type === 'project-tabs') return <MockDialog title="Project Tabs" onClose={onClose} className="compact-workflow" footer={<><button className="secondary" onClick={onClose}>Cancel</button><button onClick={onClose}>Save</button></>}><p>Choose the tabs shown for this project. At least one tab must remain enabled.</p><div className="project-tab-options">{['Overview', 'Instructions', 'Photos', 'Parts', 'Files', 'AI Chat'].map((tab) => <label key={tab}><input type="checkbox" defaultChecked={tab !== 'AI Chat'} />{tab}</label>)}</div></MockDialog>;
  if (type === 'export-project') return <MockDialog title="Export Project" subtitle="Workbench Power Monitor" onClose={onClose} footer={<><button className="secondary" onClick={onClose}>Cancel</button><button onClick={onClose}>Export</button></>}><label>Export type<select defaultValue="selected"><option>Full project zip</option><option>Instructions PDF using browser print</option><option>Instructions HTML</option><option value="selected">Selected files/photos/parts zip</option></select></label><div className="export-options">{['Overview Notes', 'Overview Checklist', 'Instructions', 'Photos (6)', 'Linked Parts (23)', 'Part Documents', 'Current/latest tracked files', 'All tracked file versions', 'Include project-manifest.json'].map((item) => <label key={item}><input type="checkbox" defaultChecked={item !== 'All tracked file versions'} />{item}</label>)}</div></MockDialog>;
  if (type === 'new-part' || type === 'edit-part') {
    const editing = type === 'edit-part';
    return <MockDialog title={editing ? 'Edit Part' : 'New Part'} onClose={onClose} className="wide-workflow" footer={<><button className="secondary" onClick={onClose}>Cancel</button><button onClick={onClose}>Save</button></>}><div className="part-form-grid">
      <label>Name<input defaultValue={editing ? 'ESP32-S3 DevKitC-1' : ''} /></label><label>Category<select><option>Microcontrollers</option><option>Create new category...</option></select></label>
      <label>Product URL<input defaultValue={editing ? 'https://www.espressif.com/esp32-s3' : ''} /></label><label>Storage container<select><option>Organizer A</option><option>Create new container...</option></select></label>
      <label>Slot / bin / drawer<select><option>Drawer 2, Bin 4</option><option>Create new slot...</option></select></label><label>Add to project<select><option>Do not link yet</option><option>Workbench Power Monitor</option></select></label>
      <div className="drop-field wide"><strong>Image</strong><span>{editing ? 'esp32-s3.jpg' : 'Drag image here'}</span><div className="drop-field-actions"><button className="secondary">Search Web for Image</button><button className="secondary">Choose Image</button></div></div>
      <div className="drop-field"><strong>Document</strong><span>{editing ? 'ESP32-S3 Datasheet.pdf' : 'Drag document here'}</span><button className="secondary">Choose Document</button></div>
      <label className="wide">Spec summary<textarea defaultValue={editing ? 'Dual-core MCU, Wi-Fi, Bluetooth LE, USB-C, 8 MB flash.' : ''} /></label><label className="wide">Notes<textarea defaultValue={editing ? 'Use for display controller and data logging.' : ''} /></label>
    </div></MockDialog>;
  }
  if (type === 'categories') {
    const categoryRows = [[0, 'Root', 'Electronics', 'Root category'], [1, 'Sub 1', 'Microcontrollers', 'Electronics'], [1, 'Sub 1', 'Sensors', 'Electronics'], [2, 'Sub 2', 'Current', 'Sensors'], [0, 'Root', 'Mechanical', 'Root category']];
    return <MockDialog title="Edit Categories" onClose={onClose} className="wide-workflow" footer={<button className="secondary" onClick={onClose}>Close</button>}><div className="category-template-actions"><button className="secondary">Export Template</button><button className="secondary">Import Template</button></div><div className="category-create-row"><input placeholder="New category name" /><select><option>Root category</option><option>Electronics</option></select><button>Add Category</button></div><section className="category-merge"><div><h3>Merge Categories</h3><p>Move parts and children into another category.</p></div><select><option>Category to merge...</option></select><select><option>Destination...</option></select><button className="secondary">Merge</button></section><div className="category-edit-list">{categoryRows.map(([depth, level, name, parent]) => <div key={name} style={{ '--category-depth': depth }}><span>::</span><em>{level}</em><input value={name} readOnly /><select defaultValue={parent}><option>{parent}</option><option>Root category</option></select><button className="secondary">Delete</button></div>)}</div></MockDialog>;
  }
  if (type === 'import-batch') {
    const items = [['Isolated Voltage Sensor', 'Sensors / Voltage', 'No suggestion', 'Create new part'], ['INA219 Current Sensor', 'Sensors / Current', 'Exact match', 'Merge into existing'], ['24V 6A Power Supply', 'Power Supplies', 'Recommended match', 'Create new part'], ['5.08mm Terminal Block', 'Connectors', 'No suggestion', 'Create new part']];
    return <MockDialog title="DigiKey_Order_0618.csv" subtitle="Digi-Key · Jun 18, 2026" onClose={onClose} className="review-workflow" footer={<><button className="secondary" onClick={onClose}>Close</button><button onClick={onClose}>Apply Batch (4)</button></>}><div className="import-review-list">{items.map(([name, category, match, action]) => <div className="import-review-row" key={name}><label>Category<select defaultValue={category}><option>{category}</option><option>Unassigned</option></select></label><div><strong>{name}</strong><span>{match}</span><small>Quantity: 2</small></div><div><select defaultValue={action}><option>{action}</option><option>Skip</option></select><button className="secondary">Fetch Image</button></div></div>)}</div></MockDialog>;
  }
  if (type === 'import-project') {
    return <MockDialog title="Import Project Package" onClose={onClose} className="review-workflow" footer={<><button className="secondary" onClick={onClose}>Cancel</button><button onClick={onClose}>Import Project</button></>}><label>Project Name<input value="Solar Battery Monitor (Imported)" readOnly /></label><section className="import-project-section"><div><h3>Tracked File Types</h3><span>1 tracked file type will be added unless reassigned.</span></div>{[['Firmware', '.ino, .cpp'], ['Mechanical CAD', '.step, .stl']].map(([name, ext]) => <div className="tracker-import-row" key={name}><span><strong>{name}</strong><small>{ext}</small></span><select><option>Add tracked file type</option><option>Assign to existing tracked file type</option></select></div>)}</section><div className="import-review-list">{[['ESP32-S3 DevKitC-1', 'Electronics / Microcontrollers'], ['INA219 Current Sensor', 'Electronics / Sensors'], ['XT60 Connector', 'Electronics / Connectors']].map(([name, category]) => <div className="import-review-row" key={name}><label>Exported category<select><option>{category}</option><option>Unassigned</option></select></label><div><strong>{name}</strong><span>Suggested category selected</span></div><select><option>Create new part</option><option>Reuse existing part</option></select></div>)}</div></MockDialog>;
  }
  if (type === 'conflict') {
    return <MockDialog title="Review Sync Conflict" onClose={onClose} className="review-workflow" footer={<><button className="secondary">Use Host</button><button className="secondary">Combine</button><button className="secondary">Use This Computer</button><button onClick={onClose}>Resolve Selected</button><button className="secondary" onClick={onClose}>Later</button></>}><p>Host and this computer both changed before synchronization finished.</p>{[['Project Notes', 'Use 500 ms logging interval.', 'Changed logging interval to 250 ms.'], ['Checklist: Calibrate voltage channel', 'Incomplete', 'Completed today']].map(([label, host, local]) => <section className="conflict-row" key={label}><div className="section-heading"><strong>{label}</strong><select><option>Combine</option><option>Use Host</option><option>Use This Computer</option></select></div><div><article><span>Host</span><p>{host}</p></article><article><span>This computer</span><p>{local}</p></article></div></section>)}</MockDialog>;
  }
  if (type === 'states') {
    return <MockDialog title="System States" subtitle="Common loading, empty, error, offline, and success treatments." onClose={onClose} className="review-workflow" footer={<button className="secondary" onClick={onClose}>Close</button>}><div className="state-gallery"><section><span className="state-spinner" /><div><strong>Loading workspace</strong><p>Reading projects and managed files...</p></div></section><section><div><strong>No projects found</strong><p>Create a project or change the current filter.</p></div><button>New Project</button></section><section className="error-state"><div><strong>Could not save changes</strong><p>The host is unavailable. Changes remain pending on this computer.</p></div><button className="secondary">Retry</button></section><section><div><strong>Offline</strong><p>BuildBook will reconnect to the host automatically.</p></div><span className="mode-badge">Pending</span></section><section><div><strong>Backup complete</strong><p>5 projects and 1.7 GB of managed files were exported.</p></div><span className="success-text">Saved</span></section></div></MockDialog>;
  }
  return null;
}

function App() {
  const [page, setPage] = useState('projects');
  const [project, setProject] = useState(projects[0]);
  const [part, setPart] = useState(parts[0]);
  const [settings, setSettings] = useState(DEFAULTS);
  const [studioOpen, setStudioOpen] = useState(true);
  const [projectsView, setProjectsView] = useState('cards');
  const [partsView, setPartsView] = useState('cards');
  const [projectBackPage, setProjectBackPage] = useState('projects');
  const [dialog, setDialog] = useState('');

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
    projects: <ProjectsPage view={projectsView} setView={setProjectsView} thumbnails={settings.thumbnails} openDialog={setDialog} openProject={(value) => { setProject(value); setProjectBackPage('projects'); setPage('project'); }} />,
    project: <ProjectPage project={project} back={() => setPage(projectBackPage)} openDialog={setDialog} />,
    parts: <PartsPage view={partsView} setView={setPartsView} thumbnails={settings.thumbnails} openDialog={setDialog} openPart={(value) => { setPart(value); setPage('part'); }} />,
    part: <PartPage part={part} back={() => setPage('parts')} openDialog={setDialog} />,
    workspace: <SettingsWorkspacePage setPage={setPage} />,
    template: <SettingsTemplatePage back={() => setPage('workspace')} />,
    tracked: <SettingsTrackedPage back={() => setPage('workspace')} />,
    theme: <SettingsThemePage settings={settings} setSettings={setSettings} back={() => setPage('workspace')} />,
    maintenance: <SettingsMaintenancePage openDialog={setDialog} />,
    network: <SettingsNetworkPage />,
    completed: <CompletedProjectsPage thumbnails={settings.thumbnails} openProject={(value) => { setProject(value); setProjectBackPage('completed'); setPage('project'); }} />,
    search: <SearchPage setPage={setPage} />,
    imports: <ImportsPage openDialog={setDialog} />,
  }[page];

  return (
    <div className={`prototype density-${settings.density} sections-${settings.sectionStyle}`} style={style}>
      <AppSidebar page={page} setPage={setPage} width={settings.sidebarWidth} />
      <main className="app-main">{content}</main>
      {!studioOpen && <button className="studio-launch" onClick={() => setStudioOpen(true)}>Layout Studio</button>}
      {studioOpen && <Studio settings={settings} setSettings={setSettings} onClose={() => setStudioOpen(false)} openDialog={setDialog} />}
      <WorkflowDialog type={dialog} onClose={() => setDialog('')} />
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
