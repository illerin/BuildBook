import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useProgressiveList } from './useProgressiveList';
import { categoryLabel, makeId } from './data';
import { downloadBytes, isHostSyncClient, openExternalUrl, openStoredFile, savePickedFile } from './desktop';
import { fileHash } from './fileHash';
import { fileExtension, fileNameFromUrl, safeName } from './files';
import { partInfoText } from './compatibility';
import { saveImageFromUrl } from './richText';
import { descendantCategoryIds, flattenCategoryOptions, nestedCategoryLabel, suggestCategoryId } from './categoryHelpers';
import { ExpandablePdfPreview, ExpandedPartFileModal, FilePreview, isPreviewableFile } from './FilePreview';
import { useAppConfirm } from './ConfirmDialog';
import { Header, StoredImage } from './sharedUi';
import { savePartImageUrlWithThumbnail, savePartImageWithThumbnail, savePhotoThumbnailFromPath } from './imageHelpers';
import { fileLooksImage, firstDroppedFile, imageUrlFromDrop } from './dropHelpers';
import { applyStorageSelection, storageSelectionFromPart } from './storageLocationHelpers';
import { runWhenIdle } from './idle';

function PartPreviewImage({ part, className = '' }) {
  const fallback = <div className={className || undefined}>{part.name.slice(0, 2).toUpperCase()}</div>;
  if (!part.image && !part.imageThumbnail) return fallback;
  return <StoredImage className={className} path={part.imageThumbnail || part.image} alt="" fallback={fallback} />;
}


function PartInfoModal({ part, categories, onClose, onUnlink, onEdit, onUpdatePart }) {
  const [expandedPreview, setExpandedPreview] = useState(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState('');
  const [imageDropActive, setImageDropActive] = useState(false);
  const [documentBusy, setDocumentBusy] = useState(false);
  const [documentError, setDocumentError] = useState('');
  const [documentDropActive, setDocumentDropActive] = useState(false);
  const previewDocument = part.documents.find((doc) => doc.isPrimary && isPreviewableFile(doc))
    || part.documents.find(isPreviewableFile);

  const attachDocument = async (pickedFile) => {
    if (!pickedFile) return;
    setDocumentBusy(true);
    setDocumentError('');
    try {
      const stored = await savePickedFile(pickedFile, `part-documents/${part.id}`);
      const contentHash = stored.path ? await fileHash(stored.path).catch(() => '') : '';
      onUpdatePart(part.id, {
        documents: [
                  ...part.documents,
                  {
                    id: makeId('doc'),
                    name: stored.name,
                    path: stored.path,
                    sourcePath: '',
                    storageMode: 'copy',
                    size: stored.size,
                    contentHash,
                    type: stored.name.toLowerCase().endsWith('.pdf') ? 'datasheet' : 'document',
                    isPrimary: !part.documents.length,
                    createdAt: new Date().toISOString(),
                  },
        ],
      });
    } catch (error) {
      setDocumentError(String(error));
    } finally {
      setDocumentBusy(false);
    }
  };

  const attachDocumentUrl = async (url) => {
    if (!url) return;
    setDocumentBusy(true);
    setDocumentError('');
    try {
      const stored = await saveImageFromUrl(url, `part-documents/${part.id}`);
      const contentHash = stored.path ? await fileHash(stored.path).catch(() => '') : '';
      onUpdatePart(part.id, {
        documents: [
          ...part.documents,
          {
            id: makeId('doc'),
            name: stored.name,
            path: stored.path,
            sourcePath: '',
            storageMode: 'copy',
            size: stored.size,
            contentHash,
            type: stored.name.toLowerCase().endsWith('.pdf') ? 'datasheet' : 'document',
            isPrimary: !part.documents.length,
            createdAt: new Date().toISOString(),
          },
        ],
      });
    } catch (error) {
      setDocumentError(String(error));
    } finally {
      setDocumentBusy(false);
    }
  };

  const updateImage = async (file) => {
    if (!file) return;
    setImageBusy(true);
    setImageError('');
    try {
      onUpdatePart(part.id, await savePartImageWithThumbnail(file, part.id));
    } catch (error) {
      setImageError(String(error));
    } finally {
      setImageBusy(false);
    }
  };

  const updateImageUrl = async (url) => {
    if (!url) return;
    setImageBusy(true);
    setImageError('');
    try {
      onUpdatePart(part.id, await savePartImageUrlWithThumbnail(url, part.id));
    } catch (error) {
      setImageError(String(error));
    } finally {
      setImageBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal detail-modal project-part-detail-modal">
        <div className="project-part-header">
          <div
            className={`project-part-summary drop-target ${imageDropActive ? 'drop-active' : ''}`}
            onDragOverCapture={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'copy';
              setImageDropActive(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setImageDropActive(false);
            }}
            onDropCapture={(event) => {
              const url = imageUrlFromDrop(event);
              setImageDropActive(false);
              const file = firstDroppedFile(event, fileLooksImage);
              if (file) updateImage(file);
              else updateImageUrl(url);
            }}
          >
            <button
              className="image-expand-button"
              disabled={!part.image}
              onClick={() => part.image && setExpandedPreview({ name: `${part.name} image`, path: part.image, previewType: 'image' })}
            >
              <div className="part-image detail-image">{part.image ? <StoredImage path={part.image} alt="" /> : part.name.slice(0, 2).toUpperCase()}</div>
            </button>
            <div>
              <span>{categoryLabel(categories, part.categoryId)}</span>
              <h2>{part.name}</h2>
              <p>{part.storageLocation || 'No location set'}</p>
              {imageBusy && <p>Saving image...</p>}
              {imageError && <p className="error-text">{imageError}</p>}
            </div>
          </div>
          <div className="row-actions project-part-header-actions">
            <button className="danger-fill" onClick={() => onUnlink(part.id)}>Unlink</button>
            <button className="ghost" onClick={() => onEdit(part.id)}>Edit</button>
            <button className="ghost" onClick={onClose}>Close</button>
          </div>
        </div>
        <div className="project-part-content">
          <section className="project-part-panel spec-panel">
            <h3>Notes</h3>
            <p>{part.notes || 'No notes yet.'}</p>
            <h3>Product URL</h3>
            {part.productUrl ? (
              <p>
                {part.productUrl}
                <button className="ghost inline-button" onClick={() => openExternalUrl(part.productUrl)}>Open</button>
              </p>
            ) : <p>No product URL set.</p>}
          </section>
          <section
            className={`project-part-panel docs-panel drop-target ${documentDropActive ? 'drop-active' : ''}`}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'copy';
              setDocumentDropActive(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setDocumentDropActive(false);
            }}
            onDrop={(event) => {
              const url = imageUrlFromDrop(event);
              setDocumentDropActive(false);
              const file = firstDroppedFile(event);
              if (file) attachDocument(file);
              else attachDocumentUrl(url);
            }}
          >
            <div className="section-title">
              <h3>Part Documents</h3>
              <label className="file-picker inline-doc-picker">
                <input
                  type="file"
                  onChange={(event) => {
                    attachDocument(event.target.files?.[0]);
                    event.target.value = '';
                  }}
                />
                {documentBusy ? 'Saving...' : 'Attach'}
              </label>
            </div>
            {documentError && <p className="error-text">{documentError}</p>}
            <div className="part-doc-list">
              {part.documents.length ? part.documents.map((doc) => (
                <div key={doc.id} className="part-doc-row">
                  <span>{doc.name}</span>
                  <small>{doc.type || 'Document'}</small>
                  <div className="row-actions">
                    {isPreviewableFile(doc) && (
                      <button className="ghost" onClick={() => setExpandedPreview(doc)}>Preview</button>
                    )}
                    {doc.path && <button className="ghost" onClick={() => openStoredFile(doc.path)}>Open</button>}
                  </div>
                </div>
              )) : <p>No documents attached.</p>}
            </div>
          </section>
          <section className="project-part-panel pdf-panel">
            <div className="section-title">
              <h3>File Preview</h3>
              {previewDocument?.path && <button className="ghost" onClick={() => openStoredFile(previewDocument.path)}>Open</button>}
            </div>
            {previewDocument ? (
              fileExtension(previewDocument.name) === '.pdf' ? (
                <ExpandablePdfPreview pdf={previewDocument} onExpand={() => setExpandedPreview(previewDocument)} />
              ) : (
                <button className="inline-preview-button" onClick={() => setExpandedPreview(previewDocument)}>
                  <FilePreview file={previewDocument} />
                </button>
              )
            ) : <p>No previewable file attached yet.</p>}
          </section>
          <section className="project-part-panel notes-panel">
            <h3>Spec Summary</h3>
            <p>{part.specSummary || 'No spec summary yet.'}</p>
          </section>
        </div>
      </div>
      {expandedPreview && <ExpandedPartFileModal file={expandedPreview} onClose={() => setExpandedPreview(null)} />}
    </div>
  );
}


function buildCategoryTree(categories) {
  const nodes = categories.map((category) => ({ ...category, children: [] }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const roots = [];

  nodes.forEach((node) => {
    const parent = byId.get(node.parentId);
    if (parent) parent.children.push(node);
    else roots.push(node);
  });

  const sortTree = (items) => items
    .sort((a, b) => ((a.sortOrder ?? 0) - (b.sortOrder ?? 0)) || a.name.localeCompare(b.name))
    .map((item) => ({ ...item, children: sortTree(item.children) }));

  return sortTree(roots);
}

function categoryTreeCount(node, parts, categories) {
  const ids = new Set([node.id, ...descendantCategoryIds(categories, node.id)]);
  return parts.filter((part) => ids.has(part.categoryId)).length;
}

function orderedCategoryDrafts(categories) {
  return flattenCategoryOptions(categories).map((category, index) => {
    const { depth, label, fullLabel, ...cleanCategory } = category;
    return { ...cleanCategory, sortOrder: index };
  });
}

function CategoryTreeNode({ node, parts, categories, activeId, onSelect, onDropPart, draggingPartId = '', depth = 0 }) {
  const [open, setOpen] = useState(false);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div className="category-tree-line" style={{ paddingLeft: `${depth * 14}px` }}>
        {hasChildren ? (
          <button className="tree-toggle" onClick={() => setOpen((value) => !value)}>{open ? '-' : '+'}</button>
        ) : <span className="tree-toggle-spacer" />}
        <button
          data-library-category-id={node.id}
          className={`category-row tree-row ${activeId === node.id ? 'active' : ''} ${draggingPartId ? 'drop-ready' : ''}`}
          onClick={() => onSelect(node.id)}
        >
          {node.name} <span>{categoryTreeCount(node, parts, categories)}</span>
        </button>
      </div>
      {open && hasChildren && node.children.map((child) => (
        <CategoryTreeNode
          key={child.id}
          node={child}
          parts={parts}
          categories={categories}
          activeId={activeId}
          onSelect={onSelect}
          onDropPart={onDropPart}
          draggingPartId={draggingPartId}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}

function CategoryManager({ categories, onUpdate, onClose }) {
  const [drafts, setDrafts] = useState(categories);
  const [newCategory, setNewCategory] = useState({ name: '', parentId: '' });
  const [dragId, setDragId] = useState('');
  const [dragOverId, setDragOverId] = useState('');
  const [dragOverPosition, setDragOverPosition] = useState('before');
  const [mergeSource, setMergeSource] = useState('');
  const [mergeTarget, setMergeTarget] = useState('');
  const [remaps, setRemaps] = useState({});
  const orderedDrafts = flattenCategoryOptions(drafts.filter((category) => category.id !== 'cat-unassigned'));

  useEffect(() => {
    setDrafts(categories);
  }, [categories]);

  const applyCategories = (nextDrafts, nextRemaps = remaps) => {
    const ordered = orderedCategoryDrafts(nextDrafts);
    setDrafts(ordered);
    onUpdate(ordered, nextRemaps);
  };

  const updateCategory = (categoryId, patch) => {
    applyCategories(drafts.map((category) => category.id === categoryId ? { ...category, ...patch } : category));
  };

  const addCategory = () => {
    if (!newCategory.name.trim()) return;
    applyCategories([
      ...drafts,
      {
        id: makeId('cat'),
        name: newCategory.name.trim(),
        parentId: newCategory.parentId || null,
        sortOrder: drafts.length,
      },
    ]);
    setNewCategory({ name: '', parentId: '' });
  };

  const deleteCategory = (categoryId) => {
    const blocked = new Set([categoryId, ...descendantCategoryIds(drafts, categoryId)]);
    applyCategories(drafts.filter((category) => !blocked.has(category.id)));
  };

  const exportTemplate = () => {
    downloadBytes('buildbook-categories.json', new TextEncoder().encode(JSON.stringify(drafts, null, 2)), 'application/json');
  };

  const importTemplate = async (file) => {
    if (!file) return;
    const imported = JSON.parse(await file.text());
    if (!Array.isArray(imported)) return;
    applyCategories(imported.map((category, index) => ({ id: category.id || makeId('cat'), name: category.name || 'Category', parentId: category.parentId || null, sortOrder: category.sortOrder ?? index })));
  };

  const reorderCategory = (activeDragId, targetId, position = 'before') => {
    setDragOverId('');
    if (!activeDragId || activeDragId === targetId) return;
    const dragged = drafts.find((category) => category.id === activeDragId);
    const target = drafts.find((category) => category.id === targetId);
    if (!dragged || !target) return;
    if (descendantCategoryIds(drafts, dragged.id).includes(target.id)) return;

    const nextParentId = target.parentId || null;
    const moved = drafts.map((category) => (
      category.id === dragged.id ? { ...category, parentId: nextParentId } : category
    ));
    const siblings = moved
      .filter((category) => (category.parentId || null) === nextParentId)
      .sort((a, b) => ((a.sortOrder ?? 0) - (b.sortOrder ?? 0)) || a.name.localeCompare(b.name));
    const fromIndex = siblings.findIndex((category) => category.id === dragged.id);
    let targetIndex = siblings.findIndex((category) => category.id === target.id);
    if (fromIndex < 0 || targetIndex < 0) return;
    const [item] = siblings.splice(fromIndex, 1);
    targetIndex = siblings.findIndex((category) => category.id === target.id);
    siblings.splice(targetIndex + (position === 'after' ? 1 : 0), 0, item);
    const siblingOrder = new Map(siblings.map((category, index) => [category.id, index]));

    applyCategories(moved.map((category) => (
      siblingOrder.has(category.id) ? { ...category, sortOrder: siblingOrder.get(category.id) } : category
    )));
    setDragId('');
    setDragOverPosition('before');
  };

  const categoryDropAtPoint = (clientX, clientY) => {
    const row = document.elementFromPoint(clientX, clientY)?.closest('[data-category-id]');
    if (!row) return { id: '', position: 'before' };
    const rect = row.getBoundingClientRect();
    return { id: row.dataset.categoryId || '', position: clientY > rect.top + rect.height / 2 ? 'after' : 'before' };
  };

  const startCategoryDrag = (event, categoryId) => {
    event.preventDefault();
    const handle = event.currentTarget;
    setDragId(categoryId);
    handle.setPointerCapture?.(event.pointerId);

    const moveCategory = (moveEvent) => {
      const target = categoryDropAtPoint(moveEvent.clientX, moveEvent.clientY);
      setDragOverId(target.id && target.id !== categoryId ? target.id : '');
      setDragOverPosition(target.position);
    };
    const finishCategoryDrag = (upEvent) => {
      const target = categoryDropAtPoint(upEvent.clientX, upEvent.clientY);
      handle.releasePointerCapture?.(event.pointerId);
      handle.removeEventListener('pointermove', moveCategory);
      handle.removeEventListener('pointerup', finishCategoryDrag);
      handle.removeEventListener('pointercancel', cancelCategoryDrag);
      reorderCategory(categoryId, target.id, target.position);
    };
    const cancelCategoryDrag = () => {
      handle.releasePointerCapture?.(event.pointerId);
      handle.removeEventListener('pointermove', moveCategory);
      handle.removeEventListener('pointerup', finishCategoryDrag);
      handle.removeEventListener('pointercancel', cancelCategoryDrag);
      setDragId('');
      setDragOverId('');
      setDragOverPosition('before');
    };

    handle.addEventListener('pointermove', moveCategory);
    handle.addEventListener('pointerup', finishCategoryDrag);
    handle.addEventListener('pointercancel', cancelCategoryDrag);
  };

  const mergeCategory = () => {
    if (!mergeSource || !mergeTarget || mergeSource === mergeTarget) return;
    const blocked = new Set([mergeSource, ...descendantCategoryIds(drafts, mergeSource)]);
    if (blocked.has(mergeTarget)) return;

    const nextDrafts = drafts
      .filter((category) => category.id !== mergeSource)
      .map((category) => category.parentId === mergeSource ? { ...category, parentId: mergeTarget } : category);
    const nextRemaps = { ...remaps, [mergeSource]: mergeTarget };
    setRemaps(nextRemaps);
    applyCategories(nextDrafts, nextRemaps);
    setMergeSource('');
    setMergeTarget('');
  };

  const levelLabel = (depth) => (depth === 0 ? 'Root' : `Sub ${depth}`);

  return (
    <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal category-manager-modal">
        <div className="section-title">
          <h2>Edit Categories</h2>
          <button className="ghost modal-x" onClick={onClose}>x</button>
        </div>
        <div className="category-template-actions">
          <button className="ghost" onClick={exportTemplate}>Export Template</button>
          <label className="file-picker header-picker">
            <input
              type="file"
              accept=".json"
              onChange={(event) => {
                importTemplate(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
            Import Template
          </label>
        </div>
        <section className="category-create-box">
          <input value={newCategory.name} onChange={(event) => setNewCategory((current) => ({ ...current, name: event.target.value }))} placeholder="New category name" />
          <select value={newCategory.parentId} onChange={(event) => setNewCategory((current) => ({ ...current, parentId: event.target.value }))}>
            <option value="">Root category</option>
            {orderedDrafts.map((category) => <option key={category.id} value={category.id}>{category.fullLabel}</option>)}
          </select>
          <button onClick={addCategory}>Add Category</button>
        </section>
        <section className="category-merge-box">
          <div>
            <h3>Merge Categories</h3>
            <p>Move parts out of one category and delete it. Child categories move under the destination.</p>
          </div>
          <select value={mergeSource} onChange={(event) => setMergeSource(event.target.value)}>
            <option value="">Category to merge...</option>
            {orderedDrafts.filter((category) => category.id !== 'cat-unassigned').map((category) => (
              <option key={category.id} value={category.id}>{category.fullLabel}</option>
            ))}
          </select>
          <select value={mergeTarget} onChange={(event) => setMergeTarget(event.target.value)}>
            <option value="">Destination...</option>
            {orderedDrafts.filter((category) => category.id !== mergeSource).map((category) => (
              <option key={category.id} value={category.id}>{category.fullLabel}</option>
            ))}
          </select>
          <button className="secondary" onClick={mergeCategory}>Merge</button>
        </section>
        <div className="category-manager-list">
          {orderedDrafts.map((category) => {
            const blocked = new Set([category.id, ...descendantCategoryIds(drafts, category.id)]);
            return (
              <div
                key={category.id}
                data-category-id={category.id}
                className={`category-edit-row depth-${Math.min(category.depth, 4)} ${dragId === category.id ? 'dragging' : ''} ${dragOverId === category.id ? `drop-${dragOverPosition}` : ''}`}
                style={{ marginLeft: `${category.depth * 28}px` }}
              >
                <span
                  className="category-drag-handle"
                  onPointerDown={(event) => startCategoryDrag(event, category.id)}
                  title="Drag to reorder"
                >
                  ::
                </span>
                <span className={`category-depth-pill depth-${Math.min(category.depth, 4)}`}>{levelLabel(category.depth)}</span>
                <input value={category.name} onChange={(event) => updateCategory(category.id, { name: event.target.value })} />
                <select value={category.parentId || ''} onChange={(event) => updateCategory(category.id, { parentId: event.target.value || null })}>
                  <option value="">Root category</option>
                  {orderedDrafts.filter((option) => !blocked.has(option.id)).map((option) => (
                    <option key={option.id} value={option.id}>{option.fullLabel}</option>
                  ))}
                </select>
                <button className="ghost" disabled={category.id === 'cat-unassigned'} onClick={() => deleteCategory(category.id)}>Delete</button>
              </div>
            );
          })}
        </div>
        <div className="modal-footer">
          <button className="secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function Parts({ state, updateState }) {
  const confirm = useAppConfirm();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [showUnassigned, setShowUnassigned] = useState(false);
  const [editingCategories, setEditingCategories] = useState(false);
  const [creatingPart, setCreatingPart] = useState(false);
  const [viewMode, setViewMode] = useState('cards');
  const [draggingPartId, setDraggingPartId] = useState('');
  const [partDragGhost, setPartDragGhost] = useState(null);
  const partDragRef = useRef(null);
  const thumbnailJobsRef = useRef(new Set());
  const suppressPartClickRef = useRef(false);
  const selected = state.parts.find((part) => part.id === selectedId) || null;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const categoryIds = categoryFilter
      ? new Set([categoryFilter, ...descendantCategoryIds(state.categories, categoryFilter)])
      : null;

    return state.parts.filter((part) => {
      if (showUnassigned && part.categoryId !== 'cat-unassigned') return false;
      if (categoryIds && !categoryIds.has(part.categoryId)) return false;
      if (!q) return true;
      return [part.name, categoryLabel(state.categories, part.categoryId), part.storageLocation, part.specSummary, part.notes]
        .some((value) => String(value || '').toLowerCase().includes(q));
    });
  }, [query, state.parts, state.categories, categoryFilter, showUnassigned]);
  const partList = useProgressiveList(visible, `${query}\0${categoryFilter}\0${showUnassigned}`, 80);

  const categoryOptions = useMemo(() => flattenCategoryOptions(state.categories), [state.categories]);
  const categoryTree = useMemo(() => buildCategoryTree(state.categories.filter((category) => category.id !== 'cat-unassigned')), [state.categories]);
  const storageLocations = state.storageLocations || [];
  const unassignedCount = state.parts.filter((part) => part.categoryId === 'cat-unassigned').length;

  const createPart = async (draft) => {
    if (!draft.name.trim()) return;
    const now = new Date().toISOString();
    const partId = makeId('part');
    const createdCategory = draft.newCategoryName?.trim()
      ? { id: makeId('cat'), name: draft.newCategoryName.trim(), parentId: draft.newCategoryParentId || null, sortOrder: state.categories.length }
      : null;
    const categoryId = createdCategory?.id || draft.categoryId || 'cat-unassigned';
    const storageResult = applyStorageSelection(state.storageLocations || [], draft);
    const image = draft.imageFile
      ? await savePartImageWithThumbnail(draft.imageFile, partId)
      : draft.imageUrl
        ? await savePartImageUrlWithThumbnail(draft.imageUrl, partId)
        : null;
    const document = draft.documentFile
      ? await savePickedFile(draft.documentFile, `part-documents/${partId}`)
      : draft.documentUrl
        ? await saveImageFromUrl(draft.documentUrl, `part-documents/${partId}`)
        : null;
    const documentHash = document?.path ? await fileHash(document.path).catch(() => '') : '';
    const part = {
      id: partId,
      name: draft.name.trim(),
      categoryId,
      image: image?.image || '',
      imageThumbnail: image?.imageThumbnail || '',
      productUrl: draft.productUrl.trim(),
      ...storageResult.partPatch,
      specSummary: draft.specSummary.trim(),
      notes: draft.notes.trim(),
      documents: document ? [{
        id: makeId('doc'),
        name: document.name,
        path: document.path,
        sourcePath: '',
        storageMode: 'copy',
        size: document.size,
        contentHash: documentHash,
        type: document.name.toLowerCase().endsWith('.pdf') ? 'datasheet' : 'document',
        createdAt: now,
      }] : [],
      createdAt: now,
      updatedAt: now,
    };
    updateState((current) => ({
      ...current,
      categories: createdCategory ? [...current.categories, createdCategory] : current.categories,
      storageLocations: storageResult.storageLocations,
      parts: [part, ...current.parts],
      projects: current.projects.map((project) => (
        project.id === draft.projectId && !project.partIds.includes(partId)
          ? { ...project, partIds: [...project.partIds, partId], partQuantities: { ...(project.partQuantities || {}), [partId]: 1 }, updatedAt: now }
          : project
      )),
    }));
    setSelectedId(partId);
    setCreatingPart(false);
  };

  const updatePart = (partId, patch) => {
    updateState((current) => ({
      ...current,
      parts: current.parts.map((part) =>
        part.id === partId ? { ...part, ...patch, updatedAt: new Date().toISOString() } : part,
      ),
    }));
  };

  const updatePartStorage = (partId, selection) => {
    updateState((current) => {
      const result = applyStorageSelection(current.storageLocations || [], selection);
      return {
        ...current,
        storageLocations: result.storageLocations,
        parts: current.parts.map((part) =>
          part.id === partId ? { ...part, ...result.partPatch, updatedAt: new Date().toISOString() } : part,
        ),
      };
    });
  };

  useEffect(() => {
    if (isHostSyncClient()) return undefined;
    const missing = visible.filter((part) => part.image && !part.imageThumbnail && !thumbnailJobsRef.current.has(part.id));
    if (!missing.length) return undefined;
    return runWhenIdle(() => {
      missing.slice(0, 2).forEach((part) => {
        thumbnailJobsRef.current.add(part.id);
        savePhotoThumbnailFromPath(part.image, part.name, `part-images/${part.id}/thumbs`)
          .then((thumbnail) => updatePart(part.id, { imageThumbnail: thumbnail.path }))
          .catch((error) => console.warn('Could not create part thumbnail', error))
          .finally(() => thumbnailJobsRef.current.delete(part.id));
      });
    });
  }, [visible]);

  const movePartToCategory = (categoryId, droppedPartId = '') => {
    const partId = droppedPartId || draggingPartId;
    if (!partId || !categoryId) return;
    updatePart(partId, { categoryId });
    setDraggingPartId('');
    setPartDragGhost(null);
  };

  const categoryDropAtPoint = (clientX, clientY) => (
    document.elementFromPoint(clientX, clientY)?.closest('[data-library-category-id]')?.dataset.libraryCategoryId || ''
  );

  const beginPartPointerDrag = (event, partId) => {
    if (event.button !== 0) return;
    partDragRef.current = { partId, x: event.clientX, y: event.clientY, dragging: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const movePartPointerDrag = (event) => {
    const drag = partDragRef.current;
    if (!drag) return;
    const moved = Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 6;
    if (moved && !drag.dragging) {
      partDragRef.current = { ...drag, dragging: true };
      setDraggingPartId(drag.partId);
    }
    if (partDragRef.current?.dragging) setPartDragGhost({ partId: drag.partId, x: event.clientX, y: event.clientY });
  };

  const endPartPointerDrag = (event) => {
    const drag = partDragRef.current;
    if (!drag) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (drag.dragging) {
      suppressPartClickRef.current = true;
      const categoryId = categoryDropAtPoint(event.clientX, event.clientY);
      if (categoryId) movePartToCategory(categoryId, drag.partId);
      else setDraggingPartId('');
      setPartDragGhost(null);
      window.setTimeout(() => {
        suppressPartClickRef.current = false;
      }, 0);
    }
    partDragRef.current = null;
  };

  const duplicatePart = (part) => {
    const copy = {
      ...part,
      id: makeId('part'),
      name: `${part.name} Copy`,
      documents: part.documents.map((doc) => ({ ...doc, id: makeId('doc') })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    updateState((current) => ({ ...current, parts: [copy, ...current.parts] }));
    setSelectedId(copy.id);
  };

  const deletePart = async (partId) => {
    const confirmed = await confirm({
      title: 'Delete part',
      message: 'Delete this part from the Parts Library and unlink it from projects?',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!confirmed) return false;
    updateState((current) => ({
      ...current,
      parts: current.parts.filter((part) => part.id !== partId),
      projects: current.projects.map((project) => ({ ...project, partIds: project.partIds.filter((id) => id !== partId) })),
    }));
    setSelectedId('');
    return true;
  };

  const linkPartToProject = (projectId, partId) => {
    if (!projectId || !partId) return;
    updateState((current) => ({
      ...current,
      projects: current.projects.map((project) => (
        project.id === projectId && !project.partIds.includes(partId)
          ? {
            ...project,
            partIds: [...project.partIds, partId],
            partQuantities: { ...(project.partQuantities || {}), [partId]: 1 },
            updatedAt: new Date().toISOString(),
          }
          : project
      )),
    }));
  };

  const unlinkPartFromProject = (projectId, partId) => {
    updateState((current) => ({
      ...current,
      projects: current.projects.map((project) => {
        if (project.id !== projectId) return project;
        const partQuantities = { ...(project.partQuantities || {}) };
        delete partQuantities[partId];
        return {
          ...project,
          partIds: project.partIds.filter((id) => id !== partId),
          partQuantities,
          updatedAt: new Date().toISOString(),
        };
      }),
    }));
  };

  const updateProjectPartQuantity = (projectId, partId, quantity) => {
    updateState((current) => ({
      ...current,
      projects: current.projects.map((project) => (
        project.id === projectId
          ? {
            ...project,
            partQuantities: { ...(project.partQuantities || {}), [partId]: Math.max(0, Number(quantity) || 0) },
            updatedAt: new Date().toISOString(),
          }
          : project
      )),
    }));
  };

  return (
    <div className="parts-library-page">
      <Header title="Parts Library" subtitle="Reference parts, storage locations, specs, datasheets, and product links.">
        <button className="secondary" onClick={() => setEditingCategories(true)}>Edit Categories</button>
        <div className="view-toggle" aria-label="Parts view">
          <button type="button" className={viewMode === 'cards' ? 'active' : ''} onClick={() => setViewMode('cards')}>Cards</button>
          <button type="button" className={viewMode === 'list' ? 'active' : ''} onClick={() => setViewMode('list')}>List</button>
        </div>
        <button onClick={() => setCreatingPart(true)}>New Part</button>
      </Header>
      <div className="parts-library-toolbar">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search parts, notes, specs..." />
        <select value={showUnassigned ? 'cat-unassigned' : categoryFilter} onChange={(event) => {
          const value = event.target.value;
          if (value === 'cat-unassigned') {
            setShowUnassigned(true);
            setCategoryFilter('');
          } else {
            setShowUnassigned(false);
            setCategoryFilter(value);
          }
        }}>
          <option value="">All categories</option>
          <option value="cat-unassigned">Unassigned</option>
          {categoryOptions.filter((category) => category.id !== 'cat-unassigned').map((category) => (
            <option key={category.id} value={category.id}>{nestedCategoryLabel(category)}</option>
          ))}
        </select>
      </div>
      <div className="library-layout">
        <aside className="library-sidebar">
          <h3>Categories</h3>
          <button
            className={`category-row ${!categoryFilter && !showUnassigned ? 'active' : ''}`}
            onClick={() => { setCategoryFilter(''); setShowUnassigned(false); }}
          >
            All parts <span>{state.parts.length}</span>
          </button>
          <button
            data-library-category-id="cat-unassigned"
            className={`category-row ${showUnassigned ? 'active' : ''} ${draggingPartId ? 'drop-ready' : ''}`}
            onClick={() => { setCategoryFilter(''); setShowUnassigned(true); }}
          >
            Unassigned <span>{unassignedCount}</span>
          </button>
          <div className="category-tree">
            {categoryTree.map((node) => (
              <CategoryTreeNode
                key={node.id}
                node={node}
                parts={state.parts}
                categories={state.categories}
                activeId={categoryFilter}
                onSelect={(id) => { setCategoryFilter(id); setShowUnassigned(false); }}
                onDropPart={movePartToCategory}
                draggingPartId={draggingPartId}
              />
            ))}
          </div>
        </aside>
        <div>
          {(query || categoryFilter || showUnassigned) && (
            <div className="toolbar">
              <button className="secondary" onClick={() => { setQuery(''); setCategoryFilter(''); setShowUnassigned(false); }}>Clear filters</button>
              <span className="muted-count">{visible.length} shown</span>
            </div>
          )}
          {visible.length === 0 ? <div className="panel empty-panel">No parts found.</div> : (
            <div className={`item-grid ${viewMode === 'list' ? 'list-view' : ''}`}>
              {partList.visibleItems.map((part) => (
                <div
                  key={part.id}
                  className={`part-card ${draggingPartId === part.id ? 'dragging' : ''}`}
                  role="button"
                  tabIndex={0}
                  onPointerDown={(event) => beginPartPointerDrag(event, part.id)}
                  onPointerMove={movePartPointerDrag}
                  onPointerUp={endPartPointerDrag}
                  onPointerCancel={(event) => {
                    event.currentTarget.releasePointerCapture?.(event.pointerId);
                    partDragRef.current = null;
                    setDraggingPartId('');
                    setPartDragGhost(null);
                  }}
                  onClick={() => {
                    if (draggingPartId || suppressPartClickRef.current) return;
                    setSelectedId(part.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedId(part.id);
                    }
                  }}
                >
                  <div className="part-card-image" draggable={false}>{part.image ? <PartPreviewImage part={part} /> : <div className="image-placeholder">Part</div>}</div>
                  <div className="part-card-body">
                    <span>{categoryLabel(state.categories, part.categoryId)}</span>
                    <strong>{part.name}</strong>
                    <p>{part.storageLocation || 'No location set'}</p>
                    <div className="mini-meta">
                      <span>{part.documents.length} docs</span>
                      {part.productUrl && <span>Product link</span>}
                    </div>
                  </div>
                </div>
              ))}
              {partList.hasMore && (
                <button ref={partList.sentinelRef} className="secondary progressive-list-more" onClick={partList.loadMore}>
                  Load more parts
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      {selected && (
        <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && setSelectedId('')}>
          <div className="modal part-library-modal">
            <PartEditor
              part={selected}
              categories={state.categories}
              projects={state.projects}
              storageLocations={storageLocations}
              onClose={() => setSelectedId('')}
              onUpdate={(patch) => updatePart(selected.id, patch)}
              onStorageChange={(selection) => updatePartStorage(selected.id, selection)}
              onLinkProject={linkPartToProject}
              onUnlinkProject={unlinkPartFromProject}
              onProjectQuantityChange={updateProjectPartQuantity}
              onDuplicate={() => duplicatePart(selected)}
              onDelete={() => deletePart(selected.id)}
              onCreateCategory={(name, parentId) => {
                const category = { id: makeId('cat'), name, parentId: parentId || null, sortOrder: state.categories.length };
                updateState((current) => ({ ...current, categories: [...current.categories, category] }));
                updatePart(selected.id, { categoryId: category.id });
              }}
            />
          </div>
        </div>
      )}
      {partDragGhost && (() => {
        const part = state.parts.find((item) => item.id === partDragGhost.partId);
        if (!part) return null;
        return (
          <div className="part-drag-ghost" style={{ left: partDragGhost.x + 14, top: partDragGhost.y + 14 }}>
            <div className="part-drag-ghost-image">{part.image ? <PartPreviewImage part={part} /> : part.name.slice(0, 2).toUpperCase()}</div>
            <div>
              <strong>{part.name}</strong>
              <span>{categoryLabel(state.categories, part.categoryId)}</span>
            </div>
          </div>
        );
      })()}
      {creatingPart && (
        <NewPartDialog
          categories={state.categories}
          projects={state.projects.filter((project) => project.status === 'active')}
          storageLocations={storageLocations}
          onCreate={createPart}
          onClose={() => setCreatingPart(false)}
        />
      )}
      {editingCategories && (
        <CategoryManager
          categories={state.categories}
          onClose={() => setEditingCategories(false)}
          onUpdate={(categories, remaps = {}) => updateState((current) => ({
            ...current,
            categories,
            parts: current.parts.map((part) => {
              const categoryId = remaps[part.categoryId] || part.categoryId;
              return categories.some((category) => category.id === categoryId) ? { ...part, categoryId } : { ...part, categoryId: 'cat-unassigned' };
            }),
          }))}
        />
      )}
    </div>
  );
}

function NewPartDialog({ categories, projects, storageLocations = [], onCreate, onClose }) {
  const [draft, setDraft] = useState({
    name: '',
    categoryId: 'cat-unassigned',
    productUrl: '',
    storageContainerId: '',
    storageSlotId: '',
    newContainerName: '',
    newSlotName: '',
    imageFile: null,
    imageUrl: '',
    documentFile: null,
    documentUrl: '',
    projectId: '',
    specSummary: '',
    notes: '',
    newCategoryName: '',
    newCategoryParentId: '',
  });
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [creatingContainer, setCreatingContainer] = useState(false);
  const [creatingSlot, setCreatingSlot] = useState(false);
  const [imageDropActive, setImageDropActive] = useState(false);
  const [documentDropActive, setDocumentDropActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [imageError, setImageError] = useState('');
  const [documentError, setDocumentError] = useState('');
  const categoryOptions = useMemo(() => flattenCategoryOptions(categories), [categories]);

  const updateName = (name) => {
    setDraft((current) => ({
      ...current,
      name,
      categoryId: categoryTouched ? current.categoryId : suggestCategoryId(name, categories),
    }));
  };

  const save = async () => {
    setBusy(true);
    setError('');
    setImageError('');
    setDocumentError('');
    try {
      await onCreate(draft);
    } catch (err) {
      const message = String(err?.message || err);
      if (draft.imageUrl && /image|download|remote|fetch|curl|url/i.test(message)) {
        setImageError(message);
      } else if (draft.documentUrl && /document|download|remote|fetch|curl|url/i.test(message)) {
        setDocumentError(message);
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  };

  const setImageFile = (file) => {
    if (!file) return;
    setImageError('');
    setDraft((current) => ({ ...current, imageFile: file, imageUrl: '' }));
  };

  const setImageUrl = (url) => {
    if (!url) return;
    setImageError('');
    setDraft((current) => ({ ...current, imageFile: null, imageUrl: url }));
  };

  const clearImageSource = () => {
    setImageError('');
    setDraft((current) => ({ ...current, imageFile: null, imageUrl: '' }));
  };

  const setDocumentFile = (file) => {
    if (!file) return;
    setDocumentError('');
    setDraft((current) => ({ ...current, documentFile: file, documentUrl: '' }));
  };

  const setDocumentUrl = (url) => {
    if (!url) return;
    setDocumentError('');
    setDraft((current) => ({ ...current, documentFile: null, documentUrl: url }));
  };

  const clearDocumentSource = () => {
    setDocumentError('');
    setDraft((current) => ({ ...current, documentFile: null, documentUrl: '' }));
  };

  return (
    <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal new-part-modal">
        <h2>New Part</h2>
        <div className="new-part-grid">
          <label>Name<input autoFocus value={draft.name} onChange={(event) => updateName(event.target.value)} /></label>
          <label>Category
            <select value={creatingCategory ? '__new__' : draft.categoryId} onChange={(event) => {
              setCategoryTouched(true);
              if (event.target.value === '__new__') {
                setCreatingCategory(true);
                setDraft((current) => ({ ...current, categoryId: 'cat-unassigned' }));
              } else {
                setCreatingCategory(false);
                setDraft((current) => ({ ...current, categoryId: event.target.value, newCategoryName: '', newCategoryParentId: '' }));
              }
            }}>
              <option value="__new__">Create new category...</option>
              <option value="cat-unassigned">Uncategorized</option>
              {categoryOptions.filter((category) => category.id !== 'cat-unassigned').map((category) => (
                <option key={category.id} value={category.id}>{nestedCategoryLabel(category)}</option>
              ))}
            </select>
          </label>
          {creatingCategory && (
            <div className="mini-create-grid wide">
              <input value={draft.newCategoryName} onChange={(event) => setDraft((current) => ({ ...current, newCategoryName: event.target.value }))} placeholder="New category name" />
              <select value={draft.newCategoryParentId} onChange={(event) => setDraft((current) => ({ ...current, newCategoryParentId: event.target.value }))}>
                <option value="">Root category</option>
                {categoryOptions.filter((category) => category.id !== 'cat-unassigned').map((category) => (
                  <option key={category.id} value={category.id}>{nestedCategoryLabel(category)}</option>
                ))}
              </select>
            </div>
          )}
          <label>Product URL<input value={draft.productUrl} onChange={(event) => setDraft((current) => ({ ...current, productUrl: event.target.value }))} placeholder="https://..." /></label>
          <label>Storage container
            <select value={creatingContainer ? '__new__' : draft.storageContainerId} onChange={(event) => {
              if (event.target.value === '__new__') {
                setCreatingContainer(true);
                setCreatingSlot(true);
                setDraft((current) => ({ ...current, storageContainerId: '', storageSlotId: '' }));
              } else {
                setCreatingContainer(false);
                setDraft((current) => ({ ...current, storageContainerId: event.target.value, storageSlotId: '', newContainerName: '', newSlotName: '' }));
              }
            }}>
              <option value="__new__">Create new container...</option>
              <option value="">No container</option>
              {storageLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
            </select>
          </label>
          {creatingContainer && (
            <label>New container<input value={draft.newContainerName} onChange={(event) => setDraft((current) => ({ ...current, newContainerName: event.target.value }))} placeholder="Organizer A, Drawer Cabinet..." /></label>
          )}
          <label>Slot / bin / drawer
            <select
              disabled={!draft.storageContainerId && !creatingContainer}
              value={creatingSlot ? '__new__' : draft.storageSlotId}
              onChange={(event) => {
                if (event.target.value === '__new__') {
                  setCreatingSlot(true);
                  setDraft((current) => ({ ...current, storageSlotId: '' }));
                } else {
                  setCreatingSlot(false);
                  setDraft((current) => ({ ...current, storageSlotId: event.target.value, newSlotName: '' }));
                }
              }}
            >
              <option value="__new__">Create new slot...</option>
              <option value="">No slot</option>
              {(storageLocations.find((location) => location.id === draft.storageContainerId)?.slots || []).map((slot) => <option key={slot.id} value={slot.id}>{slot.name}</option>)}
            </select>
          </label>
          {creatingSlot && (
            <label>New slot<input value={draft.newSlotName} onChange={(event) => setDraft((current) => ({ ...current, newSlotName: event.target.value }))} placeholder="Bin 1, Drawer 3, Loose..." /></label>
          )}
          <div
            className={`new-part-drop-field wide ${imageDropActive ? 'drop-active' : ''}`}
            onDragOver={(event) => {
              event.preventDefault();
              setImageDropActive(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setImageDropActive(false);
            }}
            onDrop={(event) => {
              const url = imageUrlFromDrop(event);
              setImageDropActive(false);
              const file = firstDroppedFile(event, fileLooksImage);
              if (file) setImageFile(file);
              else setImageUrl(url);
            }}
          >
            <span className="new-part-drop-label">Image</span>
            <div className="new-part-image-actions">
              <button className="ghost" type="button" disabled={!draft.name.trim()} onClick={() => openExternalUrl(`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(draft.name)}`)}>Search web for Image</button>
              <label className="file-picker header-picker">
                <input type="file" accept="image/*" onChange={(event) => setImageFile(event.target.files?.[0])} />
                Choose Image
              </label>
            </div>
            <div className="new-part-file-actions">
              <span>{draft.imageFile?.name || (draft.imageUrl ? fileNameFromUrl(draft.imageUrl) : 'Drag image here')}</span>
              {(draft.imageFile || draft.imageUrl) && <button className="ghost" type="button" onClick={clearImageSource}>Remove</button>}
            </div>
            {imageError && <p className="error-text inline-error">{imageError}</p>}
          </div>
          <div
            className={`new-part-drop-field ${documentDropActive ? 'drop-active' : ''}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDocumentDropActive(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setDocumentDropActive(false);
            }}
            onDrop={(event) => {
              const url = imageUrlFromDrop(event);
              setDocumentDropActive(false);
              const file = firstDroppedFile(event);
              if (file) setDocumentFile(file);
              else setDocumentUrl(url);
            }}
          >
            <label>Document<input type="file" onChange={(event) => setDocumentFile(event.target.files?.[0])} /></label>
            <div className="new-part-file-actions">
              <span>{draft.documentFile?.name || (draft.documentUrl ? fileNameFromUrl(draft.documentUrl) : 'Drag document here')}</span>
              {(draft.documentFile || draft.documentUrl) && <button className="ghost" type="button" onClick={clearDocumentSource}>Remove</button>}
            </div>
            {documentError && <p className="error-text inline-error">{documentError}</p>}
          </div>
          <label>Add to project
            <select value={draft.projectId} onChange={(event) => setDraft((current) => ({ ...current, projectId: event.target.value }))}>
              <option value="">Do not link yet</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
          <label className="wide">Spec summary<textarea value={draft.specSummary} onChange={(event) => setDraft((current) => ({ ...current, specSummary: event.target.value }))} /></label>
          <label className="wide">Notes<textarea value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} /></label>
        </div>
        {error && <p className="error-text">{error}</p>}
        <div className="modal-footer">
          <button className="secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button onClick={save} disabled={busy || !draft.name.trim()}>{busy ? 'Saving...' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

function PartEditor({ part, categories, projects, storageLocations = [], onUpdate, onStorageChange, onLinkProject, onUnlinkProject, onProjectQuantityChange, onDuplicate, onDelete, onClose }) {
  const [documentError, setDocumentError] = useState('');
  const [documentBusy, setDocumentBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState('');
  const [imageDropActive, setImageDropActive] = useState(false);
  const [documentDropActive, setDocumentDropActive] = useState(false);
  const [creatingContainer, setCreatingContainer] = useState(false);
  const [creatingSlot, setCreatingSlot] = useState(false);
  const [newContainerName, setNewContainerName] = useState('');
  const [newSlotName, setNewSlotName] = useState('');
  const [projectToLink, setProjectToLink] = useState('');
  const [expandedPreview, setExpandedPreview] = useState(null);
  const [renamingDoc, setRenamingDoc] = useState({ id: '', name: '' });
  const previewDocument = part.documents.find((doc) => doc.isPrimary && isPreviewableFile(doc))
    || part.documents.find(isPreviewableFile);
  const linkedProjects = (projects || []).filter((project) => project.partIds.includes(part.id));
  const linkableProjects = (projects || []).filter((project) => !project.partIds.includes(part.id));
  const storageSelection = storageSelectionFromPart(part, storageLocations);
  const selectedContainer = storageLocations.find((location) => location.id === storageSelection.containerId);

  const commitStorage = (patch = {}) => {
    onStorageChange({
      containerId: storageSelection.containerId,
      slotId: storageSelection.slotId,
      newContainerName,
      newSlotName,
      ...patch,
    });
  };

  const attachDocument = async (pickedFile = null) => {
    if (!pickedFile) return;
    setDocumentBusy(true);
    setDocumentError('');
    try {
      const stored = await savePickedFile(pickedFile, `part-documents/${part.id}`);
      const contentHash = stored.path ? await fileHash(stored.path).catch(() => '') : '';
      onUpdate({
        documents: [
          ...part.documents,
          {
            id: makeId('doc'),
            name: stored.name,
            path: stored.path,
            sourcePath: '',
            storageMode: 'copy',
            size: stored.size,
            contentHash,
            type: stored.name.toLowerCase().endsWith('.pdf') ? 'datasheet' : 'document',
            isPrimary: !part.documents.length,
            createdAt: new Date().toISOString(),
          },
        ],
      });
    } catch (error) {
      setDocumentError(String(error));
    } finally {
      setDocumentBusy(false);
    }
  };

  const setPrimaryDocument = (docId) => {
    onUpdate({ documents: part.documents.map((doc) => ({ ...doc, isPrimary: doc.id === docId })) });
  };

  const renameDocument = () => {
    const name = renamingDoc.name.trim();
    if (!renamingDoc.id || !name) return;
    onUpdate({ documents: part.documents.map((doc) => doc.id === renamingDoc.id ? { ...doc, name } : doc) });
    setRenamingDoc({ id: '', name: '' });
  };

  const updateImage = async (file) => {
    if (!file) return;
    const isImage = file.type.startsWith('image/') || /\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(file.name);
    if (!isImage) {
      setImageError('Only image files can be used as the part photo.');
      return;
    }
    setImageError('');
    setImageBusy(true);
    try {
      onUpdate(await savePartImageWithThumbnail(file, part.id));
    } catch (error) {
      setImageError(String(error));
    } finally {
      setImageBusy(false);
    }
  };

  const updateImageUrl = async (url) => {
    if (!url) return;
    setImageError('');
    setImageBusy(true);
    try {
      onUpdate(await savePartImageUrlWithThumbnail(url, part.id));
    } catch (error) {
      setImageError(String(error));
    } finally {
      setImageBusy(false);
    }
  };

  const attachDocumentUrl = async (url) => {
    if (!url) return;
    setDocumentBusy(true);
    setDocumentError('');
    try {
      const stored = await saveImageFromUrl(url, `part-documents/${part.id}`);
      const contentHash = stored.path ? await fileHash(stored.path).catch(() => '') : '';
      onUpdate({
        documents: [
          ...part.documents,
          {
            id: makeId('doc'),
            name: stored.name,
            path: stored.path,
            sourcePath: '',
            storageMode: 'copy',
            size: stored.size,
            contentHash,
            type: stored.name.toLowerCase().endsWith('.pdf') ? 'datasheet' : 'document',
            isPrimary: !part.documents.length,
            createdAt: new Date().toISOString(),
          },
        ],
      });
    } catch (error) {
      setDocumentError(String(error));
    } finally {
      setDocumentBusy(false);
    }
  };

  return (
    <section className="panel detail-panel">
      <div className="section-title">
        <h2>{part.name}</h2>
        {onClose && <button className="ghost" onClick={onClose}>Close</button>}
        <button className="ghost" onClick={() => downloadBytes(`${safeName(part.name)}-part-info.txt`, new TextEncoder().encode(partInfoText(part, categories)), 'text/plain')}>Export Info</button>
        <button className="ghost" onClick={onDuplicate}>Duplicate</button>
        <button className="ghost danger-button" onClick={onDelete}>Delete</button>
      </div>
      <div className="part-editor-layout">
        <div className="part-editor-main">
          <div
            className={`part-editor-image drop-target ${imageDropActive ? 'drop-active' : ''}`}
            onDragOverCapture={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'copy';
              setImageDropActive(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setImageDropActive(false);
            }}
            onDropCapture={(event) => {
              const url = imageUrlFromDrop(event);
              setImageDropActive(false);
              const file = firstDroppedFile(event, fileLooksImage);
              if (file) updateImage(file);
              else updateImageUrl(url);
            }}
          >
            <button
              className="image-expand-button"
              disabled={!part.image}
              onClick={() => part.image && setExpandedPreview({ name: `${part.name} image`, path: part.image, previewType: 'image' })}
            >
              <div className="part-image detail-image">{part.image ? <StoredImage path={part.image} alt="" /> : part.name.slice(0, 2).toUpperCase()}</div>
            </button>
            <div className="part-image-actions">
              <label className="file-picker compact-picker">
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => {
                    updateImage(event.target.files?.[0]);
                    event.target.value = '';
                  }}
                />
                {imageBusy ? 'Saving...' : part.image ? 'Change Image' : 'Add Image'}
              </label>
              <button
                className="ghost"
                type="button"
                onClick={() => openExternalUrl(`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(part.name)}`)}
                disabled={!part.name.trim()}
              >
                Search web for Image
              </button>
            </div>
            {imageError && <p className="error-text">{imageError}</p>}
          </div>
          <label>Name<input value={part.name} onChange={(event) => onUpdate({ name: event.target.value })} /></label>
          <label>
            Category
            <select value={part.categoryId} onChange={(event) => onUpdate({ categoryId: event.target.value })}>
              {flattenCategoryOptions(categories).map((category) => <option key={category.id} value={category.id}>{nestedCategoryLabel(category)}</option>)}
            </select>
          </label>
          <label>Storage Container
            <select value={creatingContainer ? '__new__' : storageSelection.containerId} onChange={(event) => {
              if (event.target.value === '__new__') {
                setCreatingContainer(true);
                setCreatingSlot(true);
                setNewContainerName('');
                setNewSlotName('');
              } else {
                setCreatingContainer(false);
                setCreatingSlot(false);
                setNewContainerName('');
                setNewSlotName('');
                commitStorage({ containerId: event.target.value, slotId: '', newContainerName: '', newSlotName: '' });
              }
            }}>
              <option value="__new__">Create new container...</option>
              <option value="">No container</option>
              {storageLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
            </select>
          </label>
          {creatingContainer && (
            <label>New Container<input value={newContainerName} onChange={(event) => setNewContainerName(event.target.value)} placeholder="Organizer A, Drawer Cabinet..." /></label>
          )}
          <label>Slot / Bin / Drawer
            <select
              disabled={!storageSelection.containerId && !creatingContainer}
              value={creatingSlot ? '__new__' : storageSelection.slotId}
              onChange={(event) => {
                if (event.target.value === '__new__') {
                  setCreatingSlot(true);
                  setNewSlotName('');
                } else {
                  setCreatingSlot(false);
                  setNewSlotName('');
                  commitStorage({ slotId: event.target.value, newSlotName: '' });
                }
              }}
            >
              <option value="__new__">Create new slot...</option>
              <option value="">No slot</option>
              {(selectedContainer?.slots || []).map((slot) => <option key={slot.id} value={slot.id}>{slot.name}</option>)}
            </select>
          </label>
          {creatingSlot && (
            <div className="input-action-row">
              <input value={newSlotName} onChange={(event) => setNewSlotName(event.target.value)} placeholder="Bin 1, Drawer 3, Loose..." />
              <button
                className="ghost"
                disabled={!storageSelection.containerId && !newContainerName.trim()}
                onClick={() => {
                  commitStorage({ newContainerName, newSlotName });
                  setCreatingContainer(false);
                  setCreatingSlot(false);
                  setNewContainerName('');
                  setNewSlotName('');
                }}
              >
                Save Location
              </button>
            </div>
          )}
          <label>
            Product URL
            <div className="input-action-row">
              <input value={part.productUrl} onChange={(event) => onUpdate({ productUrl: event.target.value })} />
              <button className="ghost" disabled={!part.productUrl} onClick={() => openExternalUrl(part.productUrl)}>Open</button>
            </div>
          </label>
          <label>Spec Summary<textarea value={part.specSummary} onChange={(event) => onUpdate({ specSummary: event.target.value })} /></label>
          <label>Notes<textarea value={part.notes} onChange={(event) => onUpdate({ notes: event.target.value })} /></label>
          <section className="part-project-usage">
            <div className="section-title">
              <h3>Project Usage</h3>
            </div>
            {linkedProjects.length ? linkedProjects.map((project) => (
              <div key={project.id} className="usage-row">
                <span>{project.name}</span>
                <label className="usage-qty-label">
                  <span>Qty</span>
                  <input
                    type="number"
                    min="0"
                    value={project.partQuantities?.[part.id] ?? 1}
                    onChange={(event) => onProjectQuantityChange(project.id, part.id, event.target.value)}
                  />
                </label>
                <button className="ghost" onClick={() => onUnlinkProject(project.id, part.id)}>Unlink</button>
              </div>
            )) : <p>No projects use this part yet.</p>}
            <div className="usage-link-row">
              <select value={projectToLink} onChange={(event) => setProjectToLink(event.target.value)}>
                <option value="">Link to project...</option>
                {linkableProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
              <button
                className="ghost"
                disabled={!projectToLink}
                onClick={() => {
                  onLinkProject(projectToLink, part.id);
                  setProjectToLink('');
                }}
              >
                Link
              </button>
            </div>
          </section>
        </div>
        <div className="part-editor-side">
          <div className="preview-box">
            <h3>File Preview</h3>
            {previewDocument ? (
              <>
                <div className="list-line">
                  <span>{previewDocument.name}</span>
                  <button className="ghost" onClick={() => openStoredFile(previewDocument.path)}>Open</button>
                </div>
                {fileExtension(previewDocument.name) === '.pdf' ? (
                  <ExpandablePdfPreview pdf={previewDocument} onExpand={() => setExpandedPreview(previewDocument)} />
                ) : (
                  <button className="inline-preview-button" onClick={() => setExpandedPreview(previewDocument)}>
                    <FilePreview file={previewDocument} />
                  </button>
                )}
              </>
            ) : <p>No previewable file attached yet.</p>}
          </div>
          <div
            className={`part-documents-panel drop-target ${documentDropActive ? 'drop-active' : ''}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDocumentDropActive(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setDocumentDropActive(false);
            }}
            onDrop={(event) => {
              const url = imageUrlFromDrop(event);
              setDocumentDropActive(false);
              const file = firstDroppedFile(event);
              if (file) attachDocument(file);
              else attachDocumentUrl(url);
            }}
          >
            <h3>Documents</h3>
            <div className="attach-form vertical">
              <label className="file-picker wide-picker">
                <input
                  type="file"
                  onChange={(event) => {
                    const pickedFile = event.target.files?.[0];
                    if (pickedFile) attachDocument(pickedFile);
                    event.target.value = '';
                  }}
                />
                {documentBusy ? 'Saving...' : 'Choose Document'}
              </label>
            </div>
            {documentError && <p className="error-text">{documentError}</p>}
            {part.documents.map((doc) => (
              <div key={doc.id} className="list-line">
                {renamingDoc.id === doc.id ? (
                  <input
                    className="document-name-input"
                    value={renamingDoc.name}
                    onChange={(event) => setRenamingDoc((current) => ({ ...current, name: event.target.value }))}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') renameDocument();
                      if (event.key === 'Escape') setRenamingDoc({ id: '', name: '' });
                    }}
                    autoFocus
                  />
                ) : <span>{doc.name}</span>}
                <div className="row-actions">
                  {renamingDoc.id === doc.id ? (
                    <>
                      <button className="ghost" onClick={renameDocument} disabled={!renamingDoc.name.trim()}>Save</button>
                      <button className="ghost" onClick={() => setRenamingDoc({ id: '', name: '' })}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button className="ghost" onClick={() => setRenamingDoc({ id: doc.id, name: doc.name })}>Rename</button>
                      <button className={doc.isPrimary ? 'latest-pill' : 'ghost'} onClick={() => setPrimaryDocument(doc.id)}>{doc.isPrimary ? 'Default' : 'Set Default'}</button>
                      {isPreviewableFile(doc) && (
                        <button className="ghost" onClick={() => setExpandedPreview(doc)}>Preview</button>
                      )}
                      {doc.path && <button className="ghost" onClick={() => openStoredFile(doc.path)}>Open</button>}
                      <button className="ghost" onClick={() => onUpdate({ documents: part.documents.filter((item) => item.id !== doc.id) })}>Delete</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {expandedPreview && <ExpandedPartFileModal file={expandedPreview} onClose={() => setExpandedPreview(null)} />}
    </section>
  );
}


export default Parts;
export { PartEditor, PartInfoModal, PartPreviewImage };
