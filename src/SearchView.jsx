import React, { useMemo, useState } from 'react';
import { categoryLabel, fileTrackerLabel } from './data';
import { Header } from './sharedUi';
import { searchWorkspace } from './searchHelpers';

export default function Search({ state, setTab }) {
  const [query, setQuery] = useState('');
  const trimmed = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!trimmed) return null;
    return searchWorkspace(state, trimmed);
  }, [trimmed, state]);
  const total = results ? Object.values(results).reduce((sum, rows) => sum + rows.length, 0) : 0;

  const ResultSection = ({ title, rows, children }) => (
    <section className="search-result-section">
      <div className="section-title">
        <h3>{title}</h3>
        <span className="muted-count">{rows.length}</span>
      </div>
      {rows.length ? children : <p>No matches.</p>}
    </section>
  );

  return (
    <div className="search-page">
      <Header title="Search" subtitle="Find projects, parts, datasheets, project files, and import drafts." />
      <div className="search-hero">
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by part, project, file, datasheet, storage location..."
        />
        {query && <button className="secondary" onClick={() => setQuery('')}>Clear</button>}
      </div>
      {!trimmed && <section className="empty-panel search-empty-state">Start typing to search across the app.</section>}
      {trimmed && results && <p className="muted-count">{total} result(s) for "{query.trim()}"</p>}
      {results && (
        <div className="search-results-grid">
          <ResultSection title="Projects" rows={results.projects}>
            <div className="search-list">
              {results.projects.map((project) => (
                <button key={project.id} onClick={() => setTab('projects')}>
                  <strong>{project.name}</strong>
                  <span>{project.status} project</span>
                </button>
              ))}
            </div>
          </ResultSection>
          <ResultSection title="Parts" rows={results.parts}>
            <div className="search-list">
              {results.parts.map((part) => (
                <button key={part.id} onClick={() => setTab('parts')}>
                  <strong>{part.name}</strong>
                  <span>{categoryLabel(state.categories, part.categoryId)}{part.storageLocation ? ` - ${part.storageLocation}` : ''}</span>
                </button>
              ))}
            </div>
          </ResultSection>
          <ResultSection title="Project Files" rows={results.files}>
            <div className="search-list">
              {results.files.map((file) => (
                <button key={file.id} onClick={() => setTab('projects')}>
                  <strong>{file.name}</strong>
                  <span>{file.projectName} - {fileTrackerLabel(state.template.fileTrackers, file.trackerId)}{file.latest ? ' - latest' : ''}</span>
                </button>
              ))}
            </div>
          </ResultSection>
          <ResultSection title="Part Documents" rows={results.documents}>
            <div className="search-list">
              {results.documents.map((doc) => (
                <button key={doc.id} onClick={() => setTab('parts')}>
                  <strong>{doc.name}</strong>
                  <span>{doc.partName} - {doc.type || 'document'}</span>
                </button>
              ))}
            </div>
          </ResultSection>
          <ResultSection title="Imports" rows={results.imports}>
            <div className="search-list">
              {results.imports.map((item, index) => (
                <button key={`${item.id || item.name || item.batchName}-${index}`} onClick={() => setTab('imports')}>
                  <strong>{item.raw?.name || item.name || 'Import item'}</strong>
                  <span>{item.batchName}{item.status ? ` - ${item.status}` : ''}</span>
                </button>
              ))}
            </div>
          </ResultSection>
        </div>
      )}
    </div>
  );
}
