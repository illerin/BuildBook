import React, { useState } from 'react';
import { makeId } from './data';
import { saveImageFromUrl } from './richText';
import { createImportItemsFromRows, createSupplierRowsFromText, extractBasicPdfText, parseCsv } from './supplierImport';
import { flattenCategoryOptions, nestedCategoryLabel } from './categoryHelpers';
import { BusyNotice, Header, StoredImage } from './sharedUi';

export default 
function Imports({ state, updateState }) {
  const [importError, setImportError] = useState('');
  const [importNotice, setImportNotice] = useState('');
  const [imageBusy, setImageBusy] = useState('');
  const [importBusy, setImportBusy] = useState('');
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [deleteBatchId, setDeleteBatchId] = useState('');
  const selectedBatch = state.importBatches.find((batch) => batch.id === selectedBatchId) || null;
  const deleteBatch = state.importBatches.find((batch) => batch.id === deleteBatchId) || null;
  const createdPartIdsForDelete = [...new Set((deleteBatch?.items || []).map((item) => item.createdPartId).filter((partId) => state.parts.some((part) => part.id === partId)))];

  const createBatch = async (file) => {
    if (!file) return;
    setImportError('');
    setImportNotice('');
    setImportBusy(`Reading ${file.name}...`);
    try {
      const lowerName = file.name.toLowerCase();
      const text = lowerName.endsWith('.pdf') ? await extractBasicPdfText(file) : await file.text();
      const rows = lowerName.endsWith('.pdf') ? createSupplierRowsFromText(text) : parseCsv(text);
      if (!rows.length) throw new Error('No importable part rows were found in that file.');
      const items = createImportItemsFromRows(rows, state.parts, state.categories);
      const batch = {
        id: makeId('batch'),
        name: file.name,
        source: lowerName.endsWith('.pdf') ? 'PDF invoice' : lowerName.includes('digikey') ? 'Digi-Key' : 'CSV',
        createdAt: new Date().toISOString(),
        items,
      };
      updateState((current) => ({ ...current, importBatches: [batch, ...current.importBatches] }));
      setSelectedBatchId(batch.id);
    } catch (error) {
      setImportError(String(error));
    } finally {
      setImportBusy('');
    }
  };

  const updateItem = (batchId, itemId, patch) => {
    updateState((current) => ({
      ...current,
      importBatches: current.importBatches.map((batch) => batch.id === batchId ? {
        ...batch,
        items: batch.items.map((item) => item.id === itemId ? { ...item, ...patch } : item),
      } : batch),
    }));
  };

  const fetchItemImage = async (batchId, item) => {
    if (!item.imageUrl) return '';
    setImageBusy(item.id);
    setImportError('');
    try {
      const stored = await saveImageFromUrl(item.imageUrl, `import-images/${batchId}`);
      updateItem(batchId, item.id, { imagePath: stored.path, imageName: stored.name });
      return stored.path;
    } catch (error) {
      setImportError(`Image fetch failed for ${item.name}: ${String(error)}`);
      return '';
    } finally {
      setImageBusy('');
    }
  };

  const completeItem = async (batchId, item, forcedAction = item.action) => {
      const action = forcedAction === 'merge' && !item.matchId ? 'create' : forcedAction;
      const imagePath = action === 'skip' ? '' : item.imagePath || await fetchItemImage(batchId, item);
      const createdPartId = action === 'create' ? makeId('part') : '';

      updateState((current) => {
        const partPatch = {
          name: item.name,
          categoryId: item.categoryId || 'cat-unassigned',
          productUrl: item.productUrl || '',
          ...(imagePath ? { image: imagePath } : {}),
          notes: [
            item.sku ? `Imported SKU: ${item.sku}` : '',
            item.quantity > 1 ? `Imported quantity: ${item.quantity}` : '',
          ].filter(Boolean).join('\n'),
          updatedAt: new Date().toISOString(),
        };
        let parts = current.parts;

        if (action === 'create') {
          parts = [{
            id: createdPartId,
            image: '',
            storageLocation: '',
            specSummary: '',
            documents: [],
            createdAt: new Date().toISOString(),
            ...partPatch,
          }, ...parts];
        } else if (action === 'merge' && item.matchId) {
          parts = parts.map((part) => part.id === item.matchId ? { ...part, ...partPatch, notes: [part.notes, partPatch.notes].filter(Boolean).join('\n') } : part);
        }

        return {
          ...current,
          parts,
          importBatches: current.importBatches.map((batch) => batch.id === batchId ? {
            ...batch,
            items: batch.items.map((draft) => draft.id === item.id ? {
              ...draft,
              imagePath,
              status: action === 'skip' ? 'skipped' : 'imported',
              action,
              createdPartId: action === 'create' ? createdPartId : '',
            } : draft),
          } : batch),
        };
      });
  };

  const removeImportBatch = (removeCreatedParts) => {
    if (!deleteBatch) return;
    const removedPartIds = removeCreatedParts ? new Set(createdPartIdsForDelete) : new Set();
    updateState((current) => ({
      ...current,
      importBatches: current.importBatches.filter((batch) => batch.id !== deleteBatch.id),
      parts: removedPartIds.size ? current.parts.filter((part) => !removedPartIds.has(part.id)) : current.parts,
      projects: removedPartIds.size ? current.projects.map((project) => ({
        ...project,
        partIds: project.partIds.filter((partId) => !removedPartIds.has(partId)),
        partQuantities: Object.fromEntries(Object.entries(project.partQuantities || {}).filter(([partId]) => !removedPartIds.has(partId))),
      })) : current.projects,
    }));
    if (selectedBatchId === deleteBatch.id) setSelectedBatchId('');
    setDeleteBatchId('');
    setImportNotice(removeCreatedParts && removedPartIds.size
      ? `Deleted import record and ${removedPartIds.size} imported part${removedPartIds.size === 1 ? '' : 's'}.`
      : 'Deleted import record.');
  };

  const categoryOptions = flattenCategoryOptions(state.categories);
  const sortedItems = (items) => [...items].sort((a, b) => {
    const rank = { none: 0, recommended: 1, exact: 2 };
    return (rank[a.matchQuality] ?? 0) - (rank[b.matchQuality] ?? 0) || a.name.localeCompare(b.name);
  });
  const draftCount = selectedBatch?.items.filter((item) => item.status === 'draft').length || 0;

  const applyBatch = async () => {
    if (!selectedBatch) return;
    const pendingItems = sortedItems(selectedBatch.items).filter((item) => item.status === 'draft');
    if (!pendingItems.length) return;
    setImportError('');
    setImportNotice('');
    try {
      for (let index = 0; index < pendingItems.length; index += 1) {
        const item = pendingItems[index];
        setImportBusy(`Applying ${index + 1} of ${pendingItems.length}: ${item.name}`);
        await completeItem(selectedBatch.id, item, item.action);
      }
      setImportNotice(`Applied ${pendingItems.length} item${pendingItems.length === 1 ? '' : 's'} from ${selectedBatch.name}.`);
      setSelectedBatchId('');
    } catch (error) {
      setImportError(`Could not finish import batch: ${String(error)}`);
    } finally {
      setImportBusy('');
    }
  };

  return (
    <div>
      <Header title="Imports" subtitle="Turn online order exports into draft parts for the library." />
      {importError && <section className="alert alert-error">{importError}</section>}
      {importNotice && <section className="alert alert-success">{importNotice}</section>}
      <BusyNotice label={importBusy} />
      <section className="panel upload-card">
        <div>
          <h3>Import CSV or PDF</h3>
          <p>Upload supplier exports, invoices, or order files to create draft parts. Quantity columns are preserved in import notes.</p>
        </div>
        <label className="file-picker header-picker">
          <input
            disabled={!!importBusy}
            type="file"
            accept=".csv,.txt,.pdf"
            onChange={(event) => {
              createBatch(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          {importBusy ? 'Importing...' : 'Import File'}
        </label>
      </section>
      <div className="imports-layout">
        <aside className="library-sidebar">
          <h3>Batches</h3>
          {state.importBatches.length === 0 ? <p>No imports yet.</p> : state.importBatches.map((batch) => (
            <div key={batch.id} className="import-row-wrap">
              <button
                className={`import-row ${selectedBatch?.id === batch.id ? 'active' : ''}`}
                onClick={() => setSelectedBatchId((current) => current === batch.id ? '' : batch.id)}
              >
                <strong>{batch.name}</strong>
                <span>{new Date(batch.createdAt).toLocaleDateString()}</span>
                <small>{batch.items.filter((item) => item.status === 'draft').length} draft / {batch.items.length} total</small>
              </button>
              <button className="ghost import-delete-button" aria-label={`Delete ${batch.name} import record`} onClick={() => setDeleteBatchId(batch.id)}>x</button>
            </div>
          ))}
        </aside>
        <section className="panel empty-panel">Select an import batch to review or apply it.</section>
      </div>
      {selectedBatch && (
        <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && !importBusy && setSelectedBatchId('')}>
          <section className="modal import-review-modal import-batch">
            <div className="section-title">
              <div>
                <h2>{selectedBatch.name}</h2>
                <span>{selectedBatch.source} - {new Date(selectedBatch.createdAt).toLocaleDateString()}</span>
              </div>
              <button className="secondary" disabled={!!importBusy} onClick={() => setSelectedBatchId('')}>Close</button>
            </div>
            <BusyNotice label={importBusy} />
            <div className="import-review-list">
              {sortedItems(selectedBatch.items).map((item) => (
                <div key={item.id} className={`import-part-row match-${item.matchQuality}`}>
                  <label>
                    Category
                    <select value={item.categoryId || 'cat-unassigned'} onChange={(event) => updateItem(selectedBatch.id, item.id, { categoryId: event.target.value })}>
                      {categoryOptions.map((category) => <option key={category.id} value={category.id}>{nestedCategoryLabel(category)}</option>)}
                    </select>
                  </label>
                  <div className="import-part-summary">
                    {(item.imagePath || item.imageUrl) && (
                      <div className="import-image-preview">
                        {item.imagePath ? <StoredImage path={item.imagePath} alt="" /> : <img src={item.imageUrl} alt="" />}
                      </div>
                    )}
                    <input value={item.name} onChange={(event) => updateItem(selectedBatch.id, item.id, { name: event.target.value })} disabled={item.status !== 'draft'} />
                    <span>{item.matchQuality === 'none' ? 'No suggestion' : item.matchQuality === 'exact' ? 'Exact match' : 'Recommended match'}</span>
                    {item.quantity > 1 && <small>Quantity: {item.quantity}</small>}
                    {item.productUrl && <small>{item.productUrl}</small>}
                    {item.imageUrl && <small>{item.imagePath ? 'Image saved locally' : item.imageUrl}</small>}
                  </div>
                  <div className="import-action-grid">
                    <select value={item.action} disabled={item.status !== 'draft' || !!importBusy} onChange={(event) => updateItem(selectedBatch.id, item.id, { action: event.target.value })}>
                      <option value="create">Create new part</option>
                      <option value="merge">Merge into existing</option>
                      <option value="skip">Skip</option>
                    </select>
                    {item.action === 'merge' && (
                      <select value={item.matchId || ''} disabled={item.status !== 'draft' || !!importBusy} onChange={(event) => updateItem(selectedBatch.id, item.id, { matchId: event.target.value })}>
                        <option value="">Choose part...</option>
                        {state.parts.map((part) => <option key={part.id} value={part.id}>{part.name}</option>)}
                      </select>
                    )}
                    {item.status === 'draft' ? (
                      item.imageUrl && !item.imagePath && <button className="ghost" disabled={imageBusy === item.id || !!importBusy} onClick={() => fetchItemImage(selectedBatch.id, item)}>{imageBusy === item.id ? 'Fetching...' : 'Fetch Image'}</button>
                    ) : <span className="status-badge">{item.status}</span>}
                  </div>
                </div>
              ))}
            </div>
            <div className="modal-actions import-batch-actions">
              <button className="secondary" disabled={!!importBusy} onClick={() => setSelectedBatchId('')}>Close</button>
              <button disabled={!draftCount || !!importBusy} onClick={applyBatch}>{importBusy ? 'Applying...' : `Apply Batch (${draftCount})`}</button>
            </div>
          </section>
        </div>
      )}
      {deleteBatch && (
        <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && setDeleteBatchId('')}>
          <section className="modal compact-modal import-delete-modal">
            <h2>Delete Import Record</h2>
            <p>Delete <strong>{deleteBatch.name}</strong> from import history?</p>
            {createdPartIdsForDelete.length
              ? <p>{createdPartIdsForDelete.length} part{createdPartIdsForDelete.length === 1 ? ' was' : 's were'} created by this import and can also be deleted.</p>
              : <p>No parts can be safely identified as created by this record. Older records may not contain that link.</p>}
            <div className="modal-footer">
              <button className="secondary" onClick={() => setDeleteBatchId('')}>Cancel</button>
              <button className="danger-fill" onClick={() => removeImportBatch(false)}>Delete Record</button>
              {createdPartIdsForDelete.length > 0 && (
                <button className="danger-fill" onClick={() => removeImportBatch(true)}>Delete Record and Parts</button>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

