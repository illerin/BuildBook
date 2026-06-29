import React, { useState } from 'react';

export default function SyncConflictReviewModal({ summary, onCancel, onResolveAll, onResolve }) {
  const items = summary?.items || [];
  const [choices, setChoices] = useState(() => Object.fromEntries(items.map((item) => [item.path, 'combine'])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const setChoice = (path, choice) => {
    setChoices((current) => ({ ...current, [path]: choice }));
  };

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await onResolve(items.map((item) => ({ path: item.path, choice: choices[item.path] || 'combine' })));
    } catch (resolveError) {
      setError(String(resolveError?.message || resolveError));
    } finally {
      setBusy(false);
    }
  };

  const resolveAll = async (choice) => {
    setBusy(true);
    setError('');
    try {
      await onResolveAll(choice);
    } catch (resolveError) {
      setError(String(resolveError?.message || resolveError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onMouseDown={(event) => event.stopPropagation()}>
      <div className="modal sync-conflict-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h2>Review Sync Conflict</h2>
        </div>
        <p className="settings-note">Host and this computer both changed before synchronization finished. Resolve this before additional changes can sync to the host.</p>
        {error && <div className="inline-error">{error}</div>}
        {items.length ? (
          <div className="sync-conflict-review-list">
            {items.map((item) => (
              <section className="sync-conflict-review-item" key={item.path}>
                <div className="sync-conflict-review-head">
                  <strong>{item.label}</strong>
                  <select value={choices[item.path] || 'combine'} onChange={(event) => setChoice(item.path, event.target.value)}>
                    <option value="combine">Combine</option>
                    <option value="host">Use Host</option>
                    <option value="local">Use This Computer</option>
                  </select>
                </div>
                <div className="sync-conflict-preview-grid">
                  <div>
                    <span>Host</span>
                    <p>{item.hostPreview || 'No preview available.'}</p>
                  </div>
                  <div>
                    <span>This computer</span>
                    <p>{item.localPreview || 'No preview available.'}</p>
                  </div>
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="sync-conflict-review-item">
            <strong>Conflict details unavailable</strong>
            <p className="settings-note">BuildBook could not break this conflict into individual fields. Choose one full version, or try an automatic combine.</p>
          </div>
        )}
        <div className="modal-actions">
          <button className="secondary" onClick={() => resolveAll('host')} disabled={busy}>Use Host</button>
          <button className="secondary" onClick={() => resolveAll('combine')} disabled={busy}>Combine</button>
          <button className="secondary" onClick={() => resolveAll('local')} disabled={busy}>Use This Computer</button>
          {items.length ? <button onClick={submit} disabled={busy}>{busy ? 'Resolving...' : 'Resolve Selected'}</button> : null}
          <button className="ghost" onClick={onCancel} disabled={busy}>Later</button>
        </div>
      </div>
    </div>
  );
}
