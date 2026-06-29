import React, { useState } from 'react';
import { categoryLabel } from './data';
import {
  descendantCategoryIds,
  flattenCategoryOptions,
  nestedCategoryLabel,
} from './categoryHelpers';

export default function LinkPartModal({ parts, linkedIds, categories, onLink, onClose, renderPartImage }) {
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const categoryOptions = flattenCategoryOptions(categories);
  const categoryFilterIds = categoryFilter ? new Set([categoryFilter, ...descendantCategoryIds(categories, categoryFilter)]) : null;
  const visibleParts = parts.filter((part) => {
    if (categoryFilterIds && !categoryFilterIds.has(part.categoryId)) return false;
    if (!query.trim()) return true;
    const text = query.trim().toLowerCase();
    return [part.name, categoryLabel(categories, part.categoryId), part.storageLocation, part.specSummary, part.notes]
      .some((value) => String(value || '').toLowerCase().includes(text));
  });

  return (
    <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal link-part-modal">
        <div className="section-title">
          <h2>Link Part</h2>
        </div>
        <label>
          Search parts
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Board, MCU, regulator..." />
        </label>
        <label>
          Category
          <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
            <option value="">All categories</option>
            {categoryOptions.filter((category) => category.id !== 'cat-unassigned').map((category) => (
              <option key={category.id} value={category.id}>
                {nestedCategoryLabel(category)}
              </option>
            ))}
          </select>
        </label>
        <div className="link-part-list">
          {visibleParts.map((part) => {
            const linked = linkedIds.includes(part.id);
            return (
              <div key={part.id} className="link-part-row">
                <div className="link-part-thumb">
                  {part.image ? renderPartImage(part) : <div className="image-placeholder">Part</div>}
                </div>
                <div className="link-part-copy">
                  <strong>{part.name}</strong>
                  <span>{categoryLabel(categories, part.categoryId)} - {part.storageLocation || 'No location'}</span>
                </div>
                {linked ? <span className="link-part-status">Linked</span> : <button className="ghost" onClick={() => onLink(part.id)}>Link</button>}
              </div>
            );
          })}
          {!visibleParts.length && <p>No parts found.</p>}
        </div>
        <div className="modal-footer">
          <button className="secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
