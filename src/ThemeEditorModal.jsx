import React, { useState } from 'react';
import { DEFAULT_THEME } from './data';
import { downloadBytes } from './desktop';
import {
  THEME_CSS_VARS,
  THEME_DERIVED_GROUPS,
  THEME_FIELD_LABELS,
  THEME_FIELDS,
  normalizeTheme,
  readThemeFile,
  themeExportBytes,
  validHexColor,
} from './theme';

export default function ThemeEditorModal({ theme, onClose, onSave }) {
  const [draft, setDraft] = useState(() => normalizeTheme(theme));
  const [error, setError] = useState('');

  const updateDraft = (key, value) => {
    setDraft((current) => normalizeTheme({ ...current, [key]: value }));
  };

  const exportTheme = () => {
    downloadBytes('buildbook-theme.json', themeExportBytes(draft), 'application/json');
  };

  const importTheme = async (file) => {
    if (!file) return;
    setError('');
    try {
      setDraft(await readThemeFile(file));
    } catch (importError) {
      setError(String(importError));
    }
  };

  const previewStyle = Object.fromEntries(
    Object.entries(THEME_CSS_VARS).map(([key, cssVar]) => [cssVar.replace('--', '--preview-'), draft[key]]),
  );

  return (
    <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal theme-modal">
        <div className="section-title">
          <h2>Theme Editor</h2>
          <button className="ghost" onClick={onClose}>Close</button>
        </div>
        <section className="theme-preview" style={previewStyle}>
          <aside>
            <strong>BuildBook</strong>
            <span>Projects</span>
            <span className="active">Parts Library</span>
            <span>Settings</span>
          </aside>
          <main>
            <div className="theme-preview-header">
              <div>
                <h3>Parts Library</h3>
                <p>Preview of the selected theme colors.</p>
              </div>
              <button>New Part</button>
            </div>
            <div className="theme-preview-tags">
              <span className="project-tag-preview">Robotics</span>
              <span className="status-active">Active</span>
              <span className="status-paused">Paused</span>
              <span className="status-waiting">Waiting</span>
              <span className="status-completed">Completed</span>
              <span className="status-archived">Archived</span>
            </div>
            <div className="theme-preview-grid">
              <article>
                <strong>Nema Motor</strong>
                <span>Motors & Motion</span>
                <input readOnly value="Drawer 1, Bin 1" />
              </article>
              <article>
                <strong>Earthquake PCB</strong>
                <span>Prototyping & Tools</span>
                <button className="danger-fill">Delete</button>
              </article>
            </div>
            <div className="theme-token-preview">
              {THEME_FIELDS.map(([key, label]) => (
                <div key={key} className="theme-token-row">
                  <div className="theme-token-main">
                    <i style={{ background: draft[key] }} title={draft[key]} />
                    <span>{label}</span>
                  </div>
                  <div className="theme-token-derived">
                    {(THEME_DERIVED_GROUPS[key] || []).map((derivedKey) => (
                      <div key={derivedKey}>
                        <i style={{ background: draft[derivedKey] }} title={draft[derivedKey]} />
                        <span>{THEME_FIELD_LABELS[derivedKey]}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </main>
        </section>
        <div className="theme-actions">
          <button onClick={() => onSave(draft)}>Save Theme</button>
          <button className="secondary" onClick={() => setDraft(normalizeTheme(DEFAULT_THEME))}>Reset Original</button>
          <button className="secondary" onClick={exportTheme}>Export Theme</button>
          <label className="file-picker header-picker backup-button">
            <input
              type="file"
              accept=".json"
              onChange={(event) => {
                importTheme(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
            Import Theme
          </label>
        </div>
        {error && <p className="error-text">{error}</p>}
        <div className="theme-color-grid">
          {THEME_FIELDS.map(([key, label]) => (
            <div key={key} className="theme-color-row">
              <span>{label}</span>
              <div className="theme-swatch-pair">
                <i style={{ background: DEFAULT_THEME[key] }} title={DEFAULT_THEME[key]} />
                <i style={{ background: draft[key] }} title={draft[key]} />
              </div>
              <input type="color" value={validHexColor(draft[key]) ? draft[key] : DEFAULT_THEME[key]} onChange={(event) => updateDraft(key, event.target.value)} />
              <input value={draft[key]} onChange={(event) => updateDraft(key, event.target.value)} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
