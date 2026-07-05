import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_PROJECT_AI_PERMISSIONS,
  DEFAULT_PROJECT_TABS,
  PROJECT_TABS,
  STATUSES,
  categoryLabel,
  fileTrackerLabel,
  makeId,
  normalizeProjectTabs,
} from './data';
import {
  acceptFromExtensions,
  assetUrl,
  currentSyncConfig,
  deleteManagedFiles,
  downloadBytes,
  extensionAllowed,
  fileCheckout,
  isHostSyncClient,
  linkedLocalFile,
  listLinkedFolderFiles,
  openExternalUrl,
  openStoredFile,
  openWithProgram,
  overwriteBytesFile,
  pickLinkedFolderPath,
  pickLinkedFilePath,
  prepareEditableFile,
  readStoredFile,
  saveBytesFile,
  savePickedFile,
} from './desktop';
import { fileHash } from './fileHash';
import {
  IMAGE_EXTENSIONS,
  dataUrlToBytes,
  fileExtension,
  fileNameFromUrl,
  imageMimeType,
  safeName,
} from './files';
import {
  buildInstructionsHtml,
  DEFAULT_PROJECT_EXPORT_OPTIONS,
  FULL_PROJECT_EXPORT_OPTIONS,
  partInfoText,
} from './compatibility';
import { buildProjectPackage, readProjectPackage } from './compatibilityProjectPackage';
import { buildWebProjectPackage } from './compatibilityWebProject';
import {
  escapeHtml,
  hydrateRichTextForEditor,
  normalizeRichText,
  richTextStorageHtml,
  sanitizePastedRichText,
  saveImageFromUrl,
  saveRichTextImageSource,
} from './richText';
import { projectNoteSheets } from './projectNotes';
import { notesPatchFromSheets } from './projectNoteHelpers';
import { isRemoteBuildBookClient } from './storage';
import { cssColor } from './theme';
import { createZip } from './zip';
import {
  descendantCategoryIds,
  findCategoryByPath,
  flattenCategoryOptions,
  nestedCategoryLabel,
} from './categoryHelpers';
import { ExpandablePdfPreview, ExpandedPartFileModal, FilePreview, isPreviewableFile } from './FilePreview';
import { useAppConfirm } from './ConfirmDialog';
import NoteImageMarkupModal from './NoteImageMarkupModal';
import ProjectAiChat from './ProjectAiChat';
import { clearProjectAiDeviceData } from './projectAi';
import ProjectImportReview from './ProjectImportReview';
import LinkPartModal from './LinkPartModal';
import { BusyNotice, Header, StoredImage } from './sharedUi';
import { PartEditor, PartInfoModal, PartPreviewImage } from './PartsView';
import {
  savePhotoThumbnail,
  savePhotoThumbnailFromPath,
} from './imageHelpers';
import {
  droppedFileList,
  fileLooksImage,
  firstDroppedFile,
  imageUrlFromDrop,
} from './dropHelpers';
import { applyStorageSelection } from './storageLocationHelpers';
import { runWhenIdle } from './idle';
import {
  fileHistoryPaths,
  normalizeRevisionSettings,
  projectRevisionSettings,
  projectTrackedStorageRows,
  pruneTrackedFiles,
  withLatestVersionNote,
} from './revisionHelpers';

async function storedImageDataUri(path, name = '') {
  if (!path) return '';
  const bytes = await readStoredFile(path);
  let binary = '';
  new Uint8Array(bytes).forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return `data:${imageMimeType(name || path)};base64,${btoa(binary)}`;
}

async function buildPrintableInstructionsHtml(project, parts) {
  const photoArchiveById = new Map();
  for (const folder of project.photoFolders || []) {
    for (const photo of folder.photos || []) {
      const path = photo.markupPath || photo.path;
      if (path) photoArchiveById.set(photo.id, await storedImageDataUri(path, photo.name));
    }
  }
  return buildInstructionsHtml(project, parts, photoArchiveById);
}

function Projects({ state, updateState, initialFilter = 'open', lockedFilter = false }) {
  const confirm = useAppConfirm();
  const [selectedId, setSelectedId] = useState('');
  const [pendingImport, setPendingImport] = useState(null);
  const [importError, setImportError] = useState('');
  const [filter, setFilter] = useState(initialFilter);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectError, setNewProjectError] = useState('');
  const [viewMode, setViewMode] = useState('cards');
  const selected = state.projects.find((project) => project.id === selectedId);
  const visibleProjects = state.projects
    .filter((project) => (
      filter === 'all' ? true
        : filter === 'open' ? !['archived', 'completed'].includes(project.status)
          : project.status === filter
    ))
    .sort((a, b) => {
      const order = { active: 0, waiting: 1, paused: 2, completed: 3, archived: 4 };
      return ((order[a.status] ?? 99) - (order[b.status] ?? 99)) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

  useEffect(() => {
    if (selected && !visibleProjects.some((project) => project.id === selected.id)) setSelectedId('');
  }, [selected, visibleProjects]);

  const openNewProjectDialog = () => {
    setNewProjectName('');
    setNewProjectError('');
    setNewProjectOpen(true);
  };

  const createProject = (event) => {
    event?.preventDefault();
    const name = newProjectName.trim();
    if (!name) {
      setNewProjectError('Project name is required.');
      return;
    }

    const project = {
      id: makeId('project'),
      name,
      status: 'active',
      image: '',
      activeSteps: [],
      notes: '',
      noteSheets: [{ id: 'project-notes', title: 'Project Notes', content: '' }],
      noteImages: [],
      checklist: state.template.checklist.map((text) => ({ id: makeId('check'), text, completedAt: '' })),
      nextSteps: [],
      partIds: [],
      partQuantities: {},
      photoFolders: [],
      instructions: { intro: '', steps: [] },
      files: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    updateState((current) => ({
      ...current,
      projects: [project, ...current.projects],
      projectTabSettings: {
        ...(current.projectTabSettings || {}),
        [project.id]: normalizeProjectTabs(current.template.tabs),
      },
      projectAiSettings: {
        ...(current.projectAiSettings || {}),
        [project.id]: { ...DEFAULT_PROJECT_AI_PERMISSIONS },
      },
    }));
    setNewProjectOpen(false);
    setNewProjectName('');
    setNewProjectError('');
    setSelectedId(project.id);
  };

  const updateProject = (projectId, patch) => {
    updateState((current) => ({
      ...current,
      projects: current.projects.map((project) =>
        project.id === projectId ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project,
      ),
    }));
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

  const createPartForProject = (projectId, draft) => {
    const now = new Date().toISOString();
    const partId = makeId('part');
    const part = {
      id: partId,
      name: draft.name.trim(),
      categoryId: draft.categoryId || 'cat-unassigned',
      image: '',
      imageThumbnail: '',
      productUrl: draft.productUrl || '',
      storageLocation: draft.storageLocation || '',
      specSummary: draft.specSummary || '',
      notes: draft.notes || '',
      documents: [],
      createdAt: now,
      updatedAt: now,
    };
    updateState((current) => ({
      ...current,
      parts: [part, ...current.parts],
      projects: current.projects.map((project) => draft.linkToProject !== false && project.id === projectId
        ? {
            ...project,
            partIds: project.partIds.includes(partId) ? project.partIds : [...project.partIds, partId],
            partQuantities: { ...(project.partQuantities || {}), [partId]: Number(draft.quantity) || 1 },
            updatedAt: now,
          }
        : project),
    }));
    return partId;
  };

  const createCategory = (name, parentId = '') => {
    const category = { id: makeId('cat'), name, parentId: parentId || null, sortOrder: state.categories.length };
    updateState((current) => ({ ...current, categories: [...current.categories, category] }));
    return category;
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
    return copy.id;
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
      projects: current.projects.map((project) => ({
        ...project,
        partIds: project.partIds.filter((id) => id !== partId),
        partQuantities: Object.fromEntries(Object.entries(project.partQuantities || {}).filter(([id]) => id !== partId)),
      })),
    }));
    return true;
  };

  const linkPartToProject = (projectId, partId) => {
    if (!projectId || !partId) return;
    updateState((current) => ({
      ...current,
      projects: current.projects.map((project) => (
        project.id === projectId
          ? {
              ...project,
              partIds: project.partIds.includes(partId) ? project.partIds : [...project.partIds, partId],
              partQuantities: { ...(project.partQuantities || {}), [partId]: project.partQuantities?.[partId] || 1 },
              updatedAt: new Date().toISOString(),
            }
          : project
      )),
    }));
  };

  const unlinkPartFromProject = (projectId, partId) => {
    if (!projectId || !partId) return;
    updateState((current) => ({
      ...current,
      projects: current.projects.map((project) => {
        if (project.id !== projectId) return project;
        const nextQuantities = { ...(project.partQuantities || {}) };
        delete nextQuantities[partId];
        return {
          ...project,
          partIds: project.partIds.filter((id) => id !== partId),
          partQuantities: nextQuantities,
          updatedAt: new Date().toISOString(),
        };
      }),
    }));
  };

  const updateProjectPartQuantity = (projectId, partId, quantity) => {
    if (!projectId || !partId) return;
    const safeQuantity = Math.max(0, Number(quantity) || 0);
    updateState((current) => ({
      ...current,
      projects: current.projects.map((project) => (
        project.id === projectId
          ? {
              ...project,
              partQuantities: { ...(project.partQuantities || {}), [partId]: safeQuantity },
              updatedAt: new Date().toISOString(),
            }
          : project
      )),
    }));
  };

  const duplicateProject = (project) => {
    const now = new Date().toISOString();
    const copy = {
      ...project,
      id: makeId('project'),
      name: `${project.name} Copy`,
      status: 'active',
      checklist: project.checklist.map((item) => ({ ...item, id: makeId('check') })),
      files: project.files.map((file) => ({ ...file, id: makeId('file') })),
      noteSheets: projectNoteSheets(project).map((sheet, index) => ({ ...sheet, id: index === 0 ? 'project-notes' : makeId('note-sheet') })),
      noteImages: (project.noteImages || []).map((image) => ({ ...image, id: makeId('note-img') })),
      photoFolders: (project.photoFolders || []).map((folder) => ({
        ...folder,
        id: makeId('photo-folder'),
        photos: (folder.photos || []).map((photo) => ({ ...photo, id: makeId('photo') })),
      })),
      instructions: {
        intro: project.instructions?.intro || '',
        steps: (project.instructions?.steps || []).map((step) => ({ ...step, id: makeId('instruction-step') })),
      },
      partQuantities: { ...(project.partQuantities || {}) },
      createdAt: now,
      updatedAt: now,
    };
    updateState((current) => ({
      ...current,
      projects: [copy, ...current.projects],
      projectTabSettings: {
        ...(current.projectTabSettings || {}),
        [copy.id]: normalizeProjectTabs(current.projectTabSettings?.[project.id] || current.template.tabs),
      },
      projectAiSettings: {
        ...(current.projectAiSettings || {}),
        [copy.id]: {
          ...DEFAULT_PROJECT_AI_PERMISSIONS,
          ...(current.projectAiSettings?.[project.id] || {}),
        },
      },
    }));
    setSelectedId(copy.id);
  };

  const deleteProject = async (projectId) => {
    const confirmed = await confirm({
      title: 'Delete project',
      message: 'Delete this project from BuildBook? Attached copied files will remain in the app folder for now.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!confirmed) return;
    updateState((current) => {
      const projectTabSettings = { ...(current.projectTabSettings || {}) };
      const projectAiSettings = { ...(current.projectAiSettings || {}) };
      delete projectTabSettings[projectId];
      delete projectAiSettings[projectId];
      return {
        ...current,
        projects: current.projects.filter((project) => project.id !== projectId),
        projectTabSettings,
        projectAiSettings,
      };
    });
    clearProjectAiDeviceData(projectId);
    setSelectedId('');
  };

  const importProjectPackage = async (file) => {
    if (!file) return;
    setImportError('');
    try {
      setPendingImport(await readProjectPackage(file));
    } catch (error) {
      setImportError(String(error));
    }
  };

  if (selected) {
    return (
      <ProjectWorkspace
        state={state}
        project={selected}
        parts={state.parts}
        template={state.template}
        categories={state.categories}
        onBack={() => setSelectedId('')}
        onUpdate={(patch) => updateProject(selected.id, patch)}
        onUpdatePart={updatePart}
        onUpdatePartStorage={updatePartStorage}
        onCreatePart={createPartForProject}
        onCreateCategory={(name, parentId) => createCategory(name, parentId)}
        onLinkProject={linkPartToProject}
        onUnlinkProject={unlinkPartFromProject}
        onProjectQuantityChange={updateProjectPartQuantity}
        onDuplicatePart={duplicatePart}
        onDeletePart={deletePart}
        onUpdateProjectTabs={(tabs) => updateState((current) => ({
          ...current,
          projectTabSettings: { ...(current.projectTabSettings || {}), [selected.id]: normalizeProjectTabs(tabs) },
        }))}
        onUpdateAiPermissions={(permissions) => updateState((current) => ({
          ...current,
          projectAiSettings: { ...(current.projectAiSettings || {}), [selected.id]: permissions },
        }))}
        onDuplicate={() => duplicateProject(selected)}
        onDelete={() => deleteProject(selected.id)}
      />
    );
  }

  return (
    <div>
      <Header
        title={lockedFilter && filter === 'completed' ? 'Completed Projects' : 'Projects'}
        subtitle={lockedFilter && filter === 'completed' ? 'Finished build records kept for reference.' : 'Your build notebook: notes, parts, files, checklist, and the next thing to do.'}
      >
        <label className="file-picker header-picker">
          <input
            type="file"
            accept=".zip,.buildbook.zip"
            onChange={(event) => {
              importProjectPackage(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          Import Project
        </label>
        <div className="view-toggle" aria-label="Project view">
          <button type="button" className={viewMode === 'cards' ? 'active' : ''} onClick={() => setViewMode('cards')}>Cards</button>
          <button type="button" className={viewMode === 'list' ? 'active' : ''} onClick={() => setViewMode('list')}>List</button>
        </div>
        <button onClick={openNewProjectDialog}>New Project</button>
      </Header>
      {!lockedFilter && (
        <div className="filters">
          {['open', 'all', 'active', 'waiting', 'paused', 'archived'].map((key) => (
            <button
              key={key}
              className={filter === key ? '' : 'secondary'}
              onClick={() => setFilter(key)}
            >
              {key === 'open' ? 'Open' : key === 'all' ? 'All' : key}
            </button>
          ))}
        </div>
      )}
      {importError && <section className="panel error-text">{importError}</section>}

      {visibleProjects.length === 0 ? (
        <section className="panel empty-panel">
          No projects found.
        </section>
      ) : (
        <div className={`project-grid ${viewMode === 'list' ? 'list-view' : ''}`}>
          {visibleProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onOpen={() => setSelectedId(project.id)}
            />
          ))}
        </div>
      )}
      {pendingImport && (
        <ProjectImportReview
          state={state}
          packageData={pendingImport}
          onCancel={() => setPendingImport(null)}
          onImport={(nextState, importedProjectId) => {
            updateState(() => nextState);
            setPendingImport(null);
            setSelectedId(importedProjectId);
          }}
        />
      )}
      {newProjectOpen && (
        <div className="modal-overlay">
          <form className="modal compact-modal" onSubmit={createProject}>
            <div className="section-title">
              <h2>New Project</h2>
              <button type="button" className="ghost modal-x" onClick={() => setNewProjectOpen(false)}>x</button>
            </div>
            <label>
              Project name
              <input
                autoFocus
                value={newProjectName}
                onChange={(event) => {
                  setNewProjectName(event.target.value);
                  if (newProjectError) setNewProjectError('');
                }}
                placeholder="Project name"
              />
            </label>
            {newProjectError && <p className="error-text">{newProjectError}</p>}
            <div className="modal-footer">
              <button type="button" className="secondary" onClick={() => setNewProjectOpen(false)}>Cancel</button>
              <button type="submit">Create</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function ProjectCard({ project, onOpen }) {
  const totalTasks = project.checklist.length;
  const doneTasks = project.checklist.filter((item) => item.completedAt).length;
  const progress = totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0;
  const latestFiles = project.files.filter((file) => file.latest);

  return (
    <button className="project-card" onClick={onOpen}>
      <div className="project-card-image">
        {project.image ? <ProjectThumbnail path={project.image} alt="" /> : <div>Project</div>}
        <span className={`status-badge status-${project.status}`}>{project.status}</span>
      </div>
      <div className="project-card-body">
        <strong>{project.name}</strong>
        <div className="project-step-tags">
          {project.activeSteps.slice(0, 4).map((step) => <span key={step}>{step}</span>)}
          {project.activeSteps.length > 4 && <span>+{project.activeSteps.length - 4}</span>}
        </div>
        <div className="mini-meta">
          <span>{project.partIds.length} parts</span>
          <span>{doneTasks}/{totalTasks} tasks</span>
          <span>{latestFiles.length} latest files</span>
        </div>
        {totalTasks > 0 && <div className="progress-bar"><div style={{ width: `${progress}%` }} /></div>}
      </div>
    </button>
  );
}

function RichTextEditor({ value, onChange, onUploadImage, placeholder = 'Write notes...' }) {
  const editorRef = useRef(null);
  const selectionRef = useRef(null);
  const fileInputRef = useRef(null);
  const objectUrlsRef = useRef([]);
  const [selectedImage, setSelectedImage] = useState(null);
  const [imageWidth, setImageWidth] = useState(100);
  const [markupSource, setMarkupSource] = useState('');
  const [textColor, setTextColor] = useState('#f3f6fb');
  const [highlightColor, setHighlightColor] = useState('#24558a');

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const normalized = normalizeRichText(value);
    if (richTextStorageHtml(editor.innerHTML) === normalized) return undefined;
    let active = true;
    hydrateRichTextForEditor(normalized)
      .then(({ html, objectUrls }) => {
        if (!active) {
          objectUrls.forEach((url) => URL.revokeObjectURL(url));
          return;
        }
        objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
        objectUrlsRef.current = objectUrls;
        editor.innerHTML = html;
      })
      .catch(() => {
        if (active) editor.innerHTML = normalized;
      });
    return () => {
      active = false;
    };
  }, [value]);

  useEffect(() => () => {
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current = [];
  }, []);

  const rememberSelection = () => {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    selectionRef.current = selection.getRangeAt(0).cloneRange();
  };

  const restoreSelection = () => {
    const selection = window.getSelection();
    if (!selection) return;
    const range = selectionRef.current;
    if (range) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
  };

  const emitChange = () => {
    onChange(richTextStorageHtml(editorRef.current?.innerHTML || ''));
  };

  const focusEmptyEditor = () => {
    const editor = editorRef.current;
    if (!editor || editor.textContent.trim() || editor.querySelector('img')) return;
    editor.innerHTML = '<p><br></p>';
    const paragraph = editor.querySelector('p') || editor;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(paragraph, 0);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    rememberSelection();
  };

  const selectImage = (image) => {
    editorRef.current?.querySelectorAll('img.rich-image-selected').forEach((item) => item.classList.remove('rich-image-selected'));
    image.classList.add('rich-image-selected');
    setSelectedImage(image);
    setImageWidth(Math.round(Number.parseFloat(image.style.width) || 100));
  };

  const updateImageWidth = (width) => {
    if (!selectedImage) return;
    selectedImage.style.width = `${width}%`;
    selectedImage.style.maxWidth = '100%';
    selectedImage.style.height = 'auto';
    setImageWidth(width);
    emitChange();
  };

  const exec = (command, commandValue = null) => {
    editorRef.current?.focus();
    restoreSelection();
    document.execCommand(command, false, commandValue);
    rememberSelection();
    emitChange();
  };

  const applyTextColor = (color) => {
    setTextColor(color);
    exec('foreColor', color);
  };

  const applyHighlightColor = (color) => {
    setHighlightColor(color);
    editorRef.current?.focus();
    restoreSelection();
    if (!document.execCommand('hiliteColor', false, color)) {
      document.execCommand('backColor', false, color);
    }
    rememberSelection();
    emitChange();
  };

  const createLink = () => {
    editorRef.current?.focus();
    restoreSelection();
    const rawUrl = window.prompt('Web link URL');
    if (!rawUrl) return;
    const url = /^(https?:|mailto:)/i.test(rawUrl.trim()) ? rawUrl.trim() : `https://${rawUrl.trim()}`;
    document.execCommand('createLink', false, url);
    const selection = window.getSelection();
    const anchor = selection?.anchorNode?.parentElement?.closest?.('a')
      || [...(editorRef.current?.querySelectorAll('a') || [])].find((item) => item.href === url || item.getAttribute('href') === url);
    if (anchor) {
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
    }
    rememberSelection();
    emitChange();
  };

  const insertSanitizedPaste = (html, plainText) => {
    const sanitized = sanitizePastedRichText(html, plainText);
    if (!sanitized) return false;
    editorRef.current?.focus();
    restoreSelection();
    document.execCommand('insertHTML', false, sanitized);
    rememberSelection();
    emitChange();
    return true;
  };

  const insertImage = async (source) => {
    if (!source) return;
    const stored = await onUploadImage(source);
    if (!stored?.path) return;
    let previewUrl = assetUrl(stored.path);
    try {
      const bytes = await readStoredFile(stored.path);
      if (bytes?.length) {
        previewUrl = URL.createObjectURL(new Blob([bytes], { type: imageMimeType(stored.path) }));
        objectUrlsRef.current.push(previewUrl);
      }
    } catch {
      // Keep stored-path preview URL if byte hydration fails.
    }
    editorRef.current?.focus();
    restoreSelection();
    const html = `<p><img src="${escapeHtml(previewUrl)}" alt="${escapeHtml(stored.name || 'Project note image')}" draggable="false" style="width:100%;max-width:100%;height:auto;border-radius:6px;" data-project-image-path="${escapeHtml(stored.path)}"></p><p><br></p>`;
    document.execCommand('insertHTML', false, html);
    rememberSelection();
    emitChange();
  };

  return (
    <div className="rich-editor">
      <div className="rich-toolbar">
        <button type="button" className="ghost" onMouseDown={(event) => event.preventDefault()} onClick={() => exec('bold')}>B</button>
        <button type="button" className="ghost" onMouseDown={(event) => event.preventDefault()} onClick={() => exec('italic')}>I</button>
        <button type="button" className="ghost" onMouseDown={(event) => event.preventDefault()} onClick={() => exec('underline')}>U</button>
        <button type="button" className="ghost" onMouseDown={(event) => event.preventDefault()} onClick={() => exec('insertUnorderedList')}>List</button>
        <button type="button" className="ghost" onMouseDown={(event) => event.preventDefault()} onClick={() => exec('formatBlock', '<h2>')}>H2</button>
        <button type="button" className="ghost" onMouseDown={(event) => event.preventDefault()} onClick={() => exec('formatBlock', '<p>')}>Text</button>
        <button type="button" className="ghost" onMouseDown={(event) => event.preventDefault()} onClick={createLink}>Link</button>
        <label className="rich-color-control" onMouseDown={rememberSelection}>
          Text color
          <input
            type="color"
            value={textColor}
            onChange={(event) => applyTextColor(event.target.value)}
            aria-label="Text color"
          />
        </label>
        <label className="rich-color-control" onMouseDown={rememberSelection}>
          Background
          <input
            type="color"
            value={highlightColor}
            onChange={(event) => applyHighlightColor(event.target.value)}
            aria-label="Text background color"
          />
        </label>
        <button type="button" className="ghost" onMouseDown={(event) => event.preventDefault()} onClick={() => fileInputRef.current?.click()}>Image</button>
        {selectedImage && (
          <div className="rich-image-tools">
            <span>Image size {imageWidth}%</span>
            <input type="range" min="5" max="100" step="5" value={imageWidth} onChange={(event) => updateImageWidth(Number(event.target.value))} />
            <button type="button" className="ghost" onMouseDown={(event) => event.preventDefault()} onClick={() => setMarkupSource(selectedImage.src)}>Markup</button>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={async (event) => {
            await insertImage(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </div>
      <div
        ref={editorRef}
        className="rich-area"
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onFocus={focusEmptyEditor}
        onInput={emitChange}
        onDragOver={(event) => event.preventDefault()}
        onDragStart={(event) => {
          if (event.target?.tagName === 'IMG') event.preventDefault();
        }}
        onDrop={async (event) => {
          const file = firstDroppedFile(event, fileLooksImage);
          if (file) await insertImage(file);
          event.preventDefault();
        }}
        onPaste={async (event) => {
          const files = [...(event.clipboardData?.files || [])];
          const file = files.find(fileLooksImage);
          const html = event.clipboardData?.getData('text/html') || '';
          const htmlImage = html.match(/src=["'](data:image\/[^"']+)["']/i)?.[1];
          const plainText = event.clipboardData?.getData('text/plain') || '';
          if (!file && !htmlImage && !html && !plainText) return;
          event.preventDefault();
          if (file || htmlImage) {
            await insertImage(file || htmlImage);
            return;
          }
          insertSanitizedPaste(html, plainText);
        }}
        onClick={(event) => {
          if (event.target?.tagName === 'IMG') {
            selectImage(event.target);
            return;
          }
          if (event.target?.closest?.('a')) {
            event.preventDefault();
            openExternalUrl(event.target.closest('a').href);
          }
        }}
        onBlur={() => {
          rememberSelection();
          emitChange();
        }}
        onKeyUp={rememberSelection}
        onMouseUp={rememberSelection}
      />
      {markupSource && (
        <NoteImageMarkupModal
          source={markupSource}
          onCancel={() => setMarkupSource('')}
          onSave={async (dataUrl) => {
            if (selectedImage) {
              const stored = await onUploadImage(dataUrl);
              if (stored?.path) {
                let nextSrc = assetUrl(stored.path);
                try {
                  const bytes = await readStoredFile(stored.path);
                  if (bytes?.length) {
                    nextSrc = URL.createObjectURL(new Blob([bytes], { type: imageMimeType(stored.path) }));
                    objectUrlsRef.current.push(nextSrc);
                  }
                } catch {
                  // Keep stored-path preview URL if byte hydration fails.
                }
                selectedImage.src = nextSrc;
                selectedImage.setAttribute('data-project-image-path', stored.path);
              }
              emitChange();
            }
            setMarkupSource('');
          }}
        />
      )}
    </div>
  );
}

function ProjectExportModal({ project, onCancel, onExport }) {
  const [format, setFormat] = useState('fullZip');
  const [options, setOptions] = useState(FULL_PROJECT_EXPORT_OPTIONS);
  const [exporting, setExporting] = useState(false);
  const photoCount = (project.photoFolders || []).reduce((total, folder) => total + (folder.photos?.length || 0), 0);
  const customOptions = format === 'selectedZip';

  const applyFormat = (nextFormat) => {
    setFormat(nextFormat);
    if (nextFormat === 'fullZip') setOptions(FULL_PROJECT_EXPORT_OPTIONS);
    if (nextFormat === 'instructionsPdf' || nextFormat === 'instructionsHtml') {
      setOptions({
        ...DEFAULT_PROJECT_EXPORT_OPTIONS,
        overviewNotes: false,
        overviewChecklist: false,
        instructions: true,
        photos: true,
        linkedParts: true,
        latestFiles: false,
        allFileVersions: false,
        partDocuments: false,
      });
    }
    if (nextFormat === 'selectedZip') setOptions(DEFAULT_PROJECT_EXPORT_OPTIONS);
  };

  const toggleOption = (key) => {
    setOptions((current) => ({
      ...current,
      [key]: !current[key],
      ...(key === 'allFileVersions' && !current[key] ? { latestFiles: true } : {}),
    }));
  };

  const runExport = async () => {
    setExporting(true);
    try {
      await onExport(format, options);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && onCancel()}>
      <div className="modal project-export-modal">
        <div className="section-title">
          <div>
            <h2>Export Project</h2>
            <p>{project.name}</p>
          </div>
        </div>
        <label>
          Export type
          <select value={format} onChange={(event) => applyFormat(event.target.value)}>
            <option value="fullZip">Full project zip</option>
            <option value="instructionsPdf">Instructions PDF using browser print</option>
            <option value="instructionsHtml">Instructions HTML</option>
            <option value="selectedZip">Selected files/photos/parts zip</option>
          </select>
        </label>
        {customOptions && (
          <div className="export-option-grid">
            <label><input type="checkbox" checked={options.overviewNotes} onChange={() => toggleOption('overviewNotes')} /><span>Overview Notes</span></label>
            <label><input type="checkbox" checked={options.overviewChecklist} onChange={() => toggleOption('overviewChecklist')} /><span>Overview Checklist</span></label>
            <label><input type="checkbox" checked={options.instructions} onChange={() => toggleOption('instructions')} /><span>Instructions</span></label>
            <label><input type="checkbox" checked={options.photos} onChange={() => toggleOption('photos')} /><span>Photos ({photoCount})</span></label>
            <label><input type="checkbox" checked={options.linkedParts} onChange={() => toggleOption('linkedParts')} /><span>Linked Parts ({project.partIds.length})</span></label>
            <label><input type="checkbox" checked={options.partDocuments} onChange={() => toggleOption('partDocuments')} /><span>Part Documents</span></label>
            <label><input type="checkbox" checked={options.latestFiles} onChange={() => toggleOption('latestFiles')} /><span>Current/latest tracked files</span></label>
            <label><input type="checkbox" checked={options.allFileVersions} onChange={() => toggleOption('allFileVersions')} /><span>All tracked file versions</span></label>
            <label><input type="checkbox" checked readOnly /><span>Include project-manifest.json</span></label>
          </div>
        )}
        <div className="modal-actions">
          <button className="secondary" onClick={onCancel} disabled={exporting}>Cancel</button>
          <button onClick={runExport} disabled={exporting}>{exporting ? 'Exporting...' : 'Export'}</button>
        </div>
      </div>
    </div>
  );
}

function ProjectWorkspace({
  state,
  project,
  parts,
  template,
  categories,
  onBack,
  onUpdate,
  onUpdatePart,
  onUpdatePartStorage,
  onCreatePart,
  onCreateCategory,
  onLinkProject,
  onUnlinkProject,
  onProjectQuantityChange,
  onDuplicatePart,
  onDeletePart,
  onUpdateProjectTabs,
  onUpdateAiPermissions,
  onDuplicate,
  onDelete,
}) {
  const [projectTab, setProjectTab] = useState('overview');
  const [imageBusy, setImageBusy] = useState(false);
  const [imagePreview, setImagePreview] = useState('');
  const [exportNotice, setExportNotice] = useState('');
  const [showExportModal, setShowExportModal] = useState(false);
  const [showProjectTabs, setShowProjectTabs] = useState(false);
  const linkedParts = project.partIds.map((id) => parts.find((part) => part.id === id)).filter(Boolean);
  const latestFiles = project.files.filter((file) => file.latest);
  const enabledTabs = normalizeProjectTabs(state.projectTabSettings?.[project.id] || template.tabs || DEFAULT_PROJECT_TABS);
  const aiPermissions = state.projectAiSettings?.[project.id] || DEFAULT_PROJECT_AI_PERMISSIONS;

  useEffect(() => {
    if (!project.image) setImagePreview('');
  }, [project.image]);

  useEffect(() => {
    if (!enabledTabs.includes(projectTab)) setProjectTab(enabledTabs[0]);
  }, [enabledTabs.join('|'), projectTab]);

  const updateImage = async (file) => {
    if (!file) return;
    const previewUrl = URL.createObjectURL(file);
    setImagePreview(previewUrl);
    setImageBusy(true);
    try {
      const stored = await savePickedFile(file, `project-images/${project.id}`);
      onUpdate({ image: stored.path });
      window.setTimeout(() => URL.revokeObjectURL(previewUrl), 1000);
    } finally {
      setImageBusy(false);
    }
  };

  const toggleStep = (step) => {
    const activeSteps = project.activeSteps.includes(step)
      ? project.activeSteps.filter((item) => item !== step)
      : [...project.activeSteps, step];
    onUpdate({ activeSteps });
  };

  const showExportMessage = (message) => {
    setExportNotice(message);
    window.clearTimeout(window.__buildBookExportNotice);
    window.__buildBookExportNotice = window.setTimeout(() => setExportNotice(''), 2600);
  };

  const exportProject = async (format, options) => {
    const exportParts = options.linkedParts ? linkedParts : [];
    if (format === 'instructionsPdf') {
      const html = await buildPrintableInstructionsHtml(project, exportParts);
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      window.open(url, '_blank');
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      showExportMessage('Instructions opened. Use browser print to save as PDF.');
      setShowExportModal(false);
      return;
    }
    if (format === 'instructionsHtml') {
      const html = await buildPrintableInstructionsHtml(project, exportParts);
      downloadBytes(`${safeName(project.name)}-instructions.html`, new TextEncoder().encode(html), 'text/html');
      showExportMessage('Instructions HTML exported.');
      setShowExportModal(false);
      return;
    }
    const bytes = await buildWebProjectPackage(state, project, options);
    downloadBytes(`${safeName(project.name)}-export.zip`, bytes, 'application/zip');
    showExportMessage('Project exported.');
    setShowExportModal(false);
  };

  return (
    <div className="project-workspace">
      <button className="secondary back-link" onClick={onBack}>Back to projects</button>
      <section className="project-hero">
        <div
          className={`project-image drop-target ${imageBusy ? 'drop-active' : ''}`}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
          }}
          onDrop={(event) => updateImage(firstDroppedFile(event, fileLooksImage))}
        >
          {imagePreview ? <img src={imagePreview} alt="" /> : project.image ? <StoredImage path={project.image} alt="" /> : <div>Project</div>}
          <label className="file-picker image-picker">
            <input
              type="file"
              accept="image/*"
              onChange={(event) => {
                updateImage(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
            {imageBusy ? 'Saving...' : project.image ? 'Change Image' : 'Add Image'}
          </label>
        </div>
        <div className="project-heading">
          <input className="project-name-input" value={project.name} onChange={(event) => onUpdate({ name: event.target.value })} />
          <div className="status-line">
            <span className={`status-badge status-${project.status}`}>{project.status}</span>
            <select value={project.status} onChange={(event) => onUpdate({ status: event.target.value })}>
              {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </div>
          <div className="mini-meta">
            <span>{linkedParts.length} linked parts</span>
            <span>{project.files.length} files</span>
            <span>{latestFiles.length} latest files</span>
          </div>
        </div>
        <div className="step-tags hero-steps">
          <button onClick={() => setShowExportModal(true)}>Export Project</button>
          <button className="danger-fill" onClick={onDelete}>Delete</button>
        </div>
      </section>
      {showExportModal && <ProjectExportModal project={project} onCancel={() => setShowExportModal(false)} onExport={exportProject} />}
      {exportNotice && <p className="export-notice">{exportNotice}</p>}
      <ProjectTagControls project={project} steps={template.steps} onToggle={toggleStep} className="project-header-tags" />
      <div className="project-tab-bar">
        <div className="tabs">
          {enabledTabs.includes('overview') && <button className={`tab ${projectTab === 'overview' ? 'active' : ''}`} onClick={() => setProjectTab('overview')}>Overview</button>}
          {enabledTabs.includes('instructions') && <button className={`tab ${projectTab === 'instructions' ? 'active' : ''}`} onClick={() => setProjectTab('instructions')}>Instructions</button>}
          {enabledTabs.includes('photos') && <button className={`tab ${projectTab === 'photos' ? 'active' : ''}`} onClick={() => setProjectTab('photos')}>Photos ({(project.photoFolders || []).reduce((total, folder) => total + (folder.photos?.length || 0), 0)})</button>}
          {enabledTabs.includes('parts') && <button className={`tab ${projectTab === 'parts' ? 'active' : ''}`} onClick={() => setProjectTab('parts')}>Parts ({linkedParts.length})</button>}
          {enabledTabs.includes('files') && <button className={`tab ${projectTab === 'files' ? 'active' : ''}`} onClick={() => setProjectTab('files')}>Files ({project.files.length})</button>}
          {enabledTabs.includes('ai') && <button className={`tab ${projectTab === 'ai' ? 'active' : ''}`} onClick={() => setProjectTab('ai')}>AI Chat</button>}
        </div>
        <button className="secondary project-tabs-button" onClick={() => setShowProjectTabs(true)}>Configure Tabs</button>
      </div>
      {showProjectTabs && (
        <ProjectTabsModal
          tabs={enabledTabs}
          onClose={() => setShowProjectTabs(false)}
          onSave={(tabs) => {
            onUpdateProjectTabs(tabs);
            setShowProjectTabs(false);
          }}
        />
      )}
      {projectTab === 'overview' && <ProjectOverviewTab project={project} template={template} onUpdate={onUpdate} />}
      {projectTab === 'parts' && (
        <ProjectPartsTab
          project={project}
          parts={parts}
          categories={categories}
          projects={state.projects}
          storageLocations={state.storageLocations || []}
          onUpdate={onUpdate}
          onUpdatePart={onUpdatePart}
          onUpdatePartStorage={onUpdatePartStorage}
          onCreateCategory={onCreateCategory}
          onLinkProject={onLinkProject}
          onUnlinkProject={onUnlinkProject}
          onProjectQuantityChange={onProjectQuantityChange}
          onDuplicatePart={onDuplicatePart}
          onDeletePart={onDeletePart}
        />
      )}
      {projectTab === 'files' && <ProjectFilesTab project={project} template={template} revisionSettings={state.revisionSettings} onUpdate={onUpdate} />}
      {projectTab === 'photos' && <ProjectPhotosTab project={project} onUpdate={onUpdate} />}
      {projectTab === 'instructions' && <ProjectInstructionsTab project={project} parts={parts} categories={categories} onUpdate={onUpdate} onCreatePart={onCreatePart} />}
      {projectTab === 'ai' && (
        <ProjectAiChat
          project={project}
          parts={parts}
          categories={categories}
          template={template}
          permissions={aiPermissions}
          onUpdatePermissions={onUpdateAiPermissions}
          onUpdateProject={onUpdate}
          onCreatePart={onCreatePart}
        />
      )}
    </div>
  );
}

function ProjectTabsModal({ tabs, onClose, onSave }) {
  const [draft, setDraft] = useState(tabs);
  const toggle = (tabId) => {
    setDraft((current) => (
      current.includes(tabId)
        ? (current.length > 1 ? current.filter((id) => id !== tabId) : current)
        : [...current, tabId]
    ));
  };
  return (
    <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal compact-modal">
        <div className="section-title">
          <h2>Project Tabs</h2>
          <button className="ghost" onClick={onClose}>Close</button>
        </div>
        <p>Choose the tabs shown for this project. At least one tab must remain enabled.</p>
        <div className="project-tab-options">
          {PROJECT_TABS.map((tab) => (
            <label key={tab.id} className="check-row">
              <input type="checkbox" checked={draft.includes(tab.id)} onChange={() => toggle(tab.id)} />
              {tab.label}
            </label>
          ))}
        </div>
        <div className="modal-footer">
          <button className="secondary" onClick={onClose}>Cancel</button>
          <button onClick={() => onSave(draft)}>Save</button>
        </div>
      </div>
    </div>
  );
}

function ProjectTagControls({ project, steps, onToggle, className = '' }) {
  return (
    <section className={`project-tags-panel ${className}`}>
      <h3>Project Tags</h3>
      <div className="step-tags quick-tag-grid">
        {steps.map((step) => (
          <button key={step} className={project.activeSteps.includes(step) ? 'tag active' : 'tag'} onClick={() => onToggle(step)}>
            {step}
          </button>
        ))}
      </div>
      {!project.activeSteps.length && <p>No quick tags selected yet.</p>}
    </section>
  );
}

function ProjectOverviewTab({ project, template, onUpdate }) {
  const confirm = useAppConfirm();
  const [newChecklist, setNewChecklist] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);
  const [recentlyCompleted, setRecentlyCompleted] = useState([]);
  const [activeNoteSheetId, setActiveNoteSheetId] = useState('');
  const [editingNoteSheetId, setEditingNoteSheetId] = useState('');
  const [draggingNoteSheetId, setDraggingNoteSheetId] = useState('');
  const visibleChecklist = showCompleted
    ? [...project.checklist].sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''))
    : project.checklist.filter((item) => !item.completedAt || recentlyCompleted.includes(item.id));
  const latestFiles = project.files.filter((file) => file.latest);
  const noteSheets = projectNoteSheets(project);
  const activeNoteSheet = noteSheets.find((sheet) => sheet.id === activeNoteSheetId) || noteSheets[0];

  useEffect(() => {
    if (!noteSheets.some((sheet) => sheet.id === activeNoteSheetId)) {
      setActiveNoteSheetId(noteSheets[0]?.id || '');
    }
  }, [activeNoteSheetId, noteSheets]);

  const addChecklistItem = () => {
    if (!newChecklist.trim()) return;
    onUpdate({ checklist: [...project.checklist, { id: makeId('check'), text: newChecklist.trim(), completedAt: '' }] });
    setNewChecklist('');
  };

  const completeChecklistItem = (itemId) => {
    setRecentlyCompleted((current) => [...current, itemId]);
    onUpdate({
      checklist: project.checklist.map((item) =>
        item.id === itemId ? { ...item, completedAt: new Date().toISOString() } : item,
      ),
    });
    window.setTimeout(() => {
      setRecentlyCompleted((current) => current.filter((id) => id !== itemId));
    }, 3000);
  };

  const addNoteImage = async (file) => {
    if (!file) return;
    return saveRichTextImageSource(file, `project-note-images/${project.id}`);
  };

  const updateNoteSheets = (sheets) => onUpdate(notesPatchFromSheets(sheets));

  const addNoteSheet = () => {
    const sheet = { id: makeId('note-sheet'), title: `Notes ${noteSheets.length + 1}`, content: '' };
    updateNoteSheets([...noteSheets, sheet]);
    setActiveNoteSheetId(sheet.id);
    setEditingNoteSheetId(sheet.id);
  };

  const renameNoteSheet = (sheetId, title) => {
    updateNoteSheets(noteSheets.map((sheet) => (
      sheet.id === sheetId ? { ...sheet, title: title.trim() || sheet.title } : sheet
    )));
    setEditingNoteSheetId('');
  };

  const updateNoteSheetContent = (sheetId, content) => {
    updateNoteSheets(noteSheets.map((sheet) => (sheet.id === sheetId ? { ...sheet, content } : sheet)));
  };

  const deleteNoteSheet = async (sheetId) => {
    if (noteSheets.length <= 1) return;
    const sheet = noteSheets.find((item) => item.id === sheetId);
    const confirmed = await confirm({
      title: 'Delete note sheet',
      message: `Delete "${sheet?.title || 'this note sheet'}"?`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!confirmed) return;
    const nextSheets = noteSheets.filter((item) => item.id !== sheetId);
    updateNoteSheets(nextSheets);
    setActiveNoteSheetId(nextSheets[0]?.id || '');
  };

  const moveNoteSheet = (sourceId, targetId) => {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const sourceIndex = noteSheets.findIndex((sheet) => sheet.id === sourceId);
    const targetIndex = noteSheets.findIndex((sheet) => sheet.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const nextSheets = [...noteSheets];
    const [moved] = nextSheets.splice(sourceIndex, 1);
    nextSheets.splice(targetIndex, 0, moved);
    updateNoteSheets(nextSheets);
  };

  return (
    <div className="dashboard-grid">
      <article className="notes-card">
        <div className="note-sheet-tabs">
          {noteSheets.map((sheet, index) => (
            <div
              key={sheet.id}
              className={`note-sheet-tab ${activeNoteSheet?.id === sheet.id ? 'active' : ''} ${draggingNoteSheetId === sheet.id ? 'dragging' : ''}`}
              draggable
              onDragStart={(event) => {
                setDraggingNoteSheetId(sheet.id);
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', sheet.id);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(event) => {
                event.preventDefault();
                moveNoteSheet(event.dataTransfer.getData('text/plain') || draggingNoteSheetId, sheet.id);
                setDraggingNoteSheetId('');
              }}
              onDragEnd={() => setDraggingNoteSheetId('')}
            >
              {editingNoteSheetId === sheet.id ? (
                <input
                  autoFocus
                  defaultValue={sheet.title}
                  onBlur={(event) => renameNoteSheet(sheet.id, event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                    if (event.key === 'Escape') setEditingNoteSheetId('');
                  }}
                />
              ) : (
                <button className="note-sheet-name" onClick={() => setActiveNoteSheetId(sheet.id)} onDoubleClick={() => setEditingNoteSheetId(sheet.id)}>
                  {sheet.title}
                </button>
              )}
              {index > 0 && <button className="ghost note-sheet-delete" title="Delete note sheet" onClick={() => deleteNoteSheet(sheet.id)}>x</button>}
            </div>
          ))}
          <button className="icon-button note-sheet-add" title="Add note sheet" onClick={addNoteSheet}>+</button>
        </div>
        <RichTextEditor value={activeNoteSheet?.content || ''} onChange={(notes) => updateNoteSheetContent(activeNoteSheet.id, notes)} onUploadImage={addNoteImage} placeholder="Document wiring, pin choices, firmware notes, problems, and decisions..." />
      </article>
      <div className="overview-side">
        <article>
          <h3>Checklist</h3>
          <div className="inline-entry checklist-toolbar">
            <input
              value={newChecklist}
              onChange={(event) => setNewChecklist(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                addChecklistItem();
              }}
              placeholder="Add checklist item"
            />
            <button onClick={addChecklistItem}>Add</button>
            <button className="secondary checklist-toggle" onClick={() => setShowCompleted((value) => !value)}>
              {showCompleted ? 'Hide Completed' : 'Show Completed'}
            </button>
          </div>
          {visibleChecklist.map((item) => (
            <label key={item.id} className={`check-line ${item.completedAt ? 'done' : ''}`}>
              <input type="checkbox" checked={Boolean(item.completedAt)} disabled={Boolean(item.completedAt)} onChange={() => completeChecklistItem(item.id)} />
              <span>{item.text}</span>
              {item.completedAt && <small>{new Date(item.completedAt).toLocaleDateString()}</small>}
            </label>
          ))}
        </article>

        <article>
          <h3>Latest Files</h3>
          {latestFiles.length ? latestFiles.map((file) => (
            <div key={file.id} className="latest">
              <strong className="tracked-file-name">{fileTrackerLabel(template.fileTrackers, file.trackerId)}</strong>
              <span>{file.name}</span>
              <div className="latest-file-actions">
                {file.path && <button className="ghost" onClick={() => openStoredFile(file.path)}>Open</button>}
                {(file.path || file.type === 'folder') && <button className="ghost" onClick={() => downloadStoredProjectFile(file)}>Download</button>}
              </div>
            </div>
          )) : <p>No latest files attached.</p>}
        </article>
      </div>
    </div>
  );
}

function compactBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (value >= 1024 * 1024) return `${Math.round(value / 1024 / 1024)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

function PhotoMarkupButton({ photo, projectId, onSave }) {
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);

  const openMarkup = async () => {
    setBusy(true);
    try {
      const bytes = await readStoredFile(photo.markupPath || photo.path);
      setSource(URL.createObjectURL(new Blob([bytes], { type: imageMimeType(photo.name) })));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="ghost" onClick={openMarkup} disabled={busy}>{busy ? 'Loading...' : 'Markup'}</button>
      {source && (
        <NoteImageMarkupModal
          source={source}
          onCancel={() => {
            URL.revokeObjectURL(source);
            setSource('');
          }}
          onSave={async (dataUrl) => {
            const stored = await saveBytesFile(`markup-${photo.name || 'photo.png'}`, `project-photos/${projectId}/markup`, dataUrlToBytes(dataUrl));
            let markupThumbnailPath = '';
            try {
              const thumbnail = await savePhotoThumbnail(new Blob([dataUrlToBytes(dataUrl)], { type: imageMimeType(photo.name) }), photo.name, `project-photos/${projectId}/thumbs`);
              markupThumbnailPath = thumbnail.path;
            } catch (error) {
              console.warn('Could not create markup thumbnail', error);
            }
            onSave({ markupPath: stored.path, markupThumbnailPath });
            URL.revokeObjectURL(source);
            setSource('');
          }}
        />
      )}
    </>
  );
}

function ProjectPhotosTab({ project, onUpdate }) {
  const [newFolderName, setNewFolderName] = useState('');
  const [selectedFolderId, setSelectedFolderId] = useState(project.photoFolders?.[0]?.id || '');
  const [expandedPhoto, setExpandedPhoto] = useState(null);
  const [photoBusy, setPhotoBusy] = useState('');
  const folders = project.photoFolders || [];
  const selectedFolder = folders.find((folder) => folder.id === selectedFolderId) || folders[0];
  const thumbnailJobsRef = useRef(new Set());

  useEffect(() => {
    if (!selectedFolderId && folders[0]) setSelectedFolderId(folders[0].id);
  }, [selectedFolderId, folders]);

  const setFolders = (photoFolders) => onUpdate({ photoFolders });

  const addFolder = () => {
    const name = newFolderName.trim();
    if (!name) return;
    const folder = { id: makeId('photo-folder'), name, photos: [] };
    setFolders([...folders, folder]);
    setSelectedFolderId(folder.id);
    setNewFolderName('');
  };

  const uploadPhotos = async (files) => {
    if (!selectedFolder || !files?.length) return;
    setPhotoBusy(`Uploading ${files.length} photo${files.length === 1 ? '' : 's'}...`);
    try {
      const uploaded = await Promise.all([...files].map(async (file) => {
        const stored = await savePickedFile(file, `project-photos/${project.id}/${selectedFolder.id}`);
        let thumbnailPath = '';
        try {
          const thumbnail = await savePhotoThumbnail(file, stored.name, `project-photos/${project.id}/thumbs`);
          thumbnailPath = thumbnail.path;
        } catch (error) {
          console.warn('Could not create photo thumbnail', error);
        }
        return { id: makeId('photo'), name: stored.name, path: stored.path, thumbnailPath, note: '', createdAt: new Date().toISOString() };
      }));
      setFolders(folders.map((folder) => folder.id === selectedFolder.id ? { ...folder, photos: [...(folder.photos || []), ...uploaded] } : folder));
    } finally {
      setPhotoBusy('');
    }
  };

  useEffect(() => {
    if (!selectedFolder) return;
    const missing = (selectedFolder.photos || []).filter((photo) => {
      const sourcePath = photo.markupPath || photo.path;
      const previewPath = photo.markupPath ? photo.markupThumbnailPath : photo.thumbnailPath;
      return sourcePath && !previewPath && !thumbnailJobsRef.current.has(photo.id);
    });
    if (!missing.length) return undefined;
    return runWhenIdle(() => {
      missing.slice(0, 2).forEach((photo) => {
        thumbnailJobsRef.current.add(photo.id);
        savePhotoThumbnailFromPath(photo.markupPath || photo.path, photo.name, `project-photos/${project.id}/thumbs`)
          .then((thumbnail) => {
            updatePhoto(photo.id, photo.markupPath ? { markupThumbnailPath: thumbnail.path } : { thumbnailPath: thumbnail.path });
          })
          .finally(() => thumbnailJobsRef.current.delete(photo.id));
      });
    });
  }, [selectedFolder, project.id]);

  const updatePhoto = (photoId, patch) => {
    setFolders(folders.map((folder) => folder.id === selectedFolder.id ? {
      ...folder,
      photos: (folder.photos || []).map((photo) => photo.id === photoId ? { ...photo, ...patch } : photo),
    } : folder));
  };

  const removePhoto = (photoId) => {
    setFolders(folders.map((folder) => folder.id === selectedFolder.id ? {
      ...folder,
      photos: (folder.photos || []).filter((photo) => photo.id !== photoId),
    } : folder));
  };

  const downloadPhoto = async (photo) => {
    setPhotoBusy(`Preparing ${photo.name || 'photo'}...`);
    try {
      const path = photo.markupPath || photo.path;
      const bytes = await readStoredFile(path);
      downloadBytes(photo.name || 'photo', bytes, imageMimeType(photo.name));
    } finally {
      setPhotoBusy('');
    }
  };

  return (
    <div className="photo-library-layout">
      <section className="panel photo-folder-panel">
        <h3>Photo Folders</h3>
        <div className="inline-entry">
          <input value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} placeholder="Folder name" />
          <button onClick={addFolder}>Add</button>
        </div>
        {folders.map((folder) => (
          <button
            key={folder.id}
            className={`photo-folder-button ${selectedFolder?.id === folder.id ? 'active' : ''}`}
            onClick={() => setSelectedFolderId(folder.id)}
          >
            {folder.name} ({folder.photos?.length || 0})
          </button>
        ))}
      </section>
      <section
        className={`panel photo-upload-panel ${photoBusy ? 'drop-active' : ''}`}
        onDragOver={(event) => {
          if (selectedFolder) event.preventDefault();
        }}
        onDrop={(event) => uploadPhotos(droppedFileList(event, fileLooksImage))}
      >
        <div className="section-title">
          <h3>{selectedFolder?.name || 'Photos'}</h3>
          {selectedFolder && (
            <label className="file-picker compact-picker">
              <input disabled={!!photoBusy} type="file" accept="image/*" multiple onChange={(event) => { uploadPhotos(event.target.files); event.target.value = ''; }} />
              {photoBusy ? 'Working...' : 'Upload Photos'}
            </label>
          )}
        </div>
        <BusyNotice label={photoBusy} />
        {!selectedFolder ? <p>Create a folder to start adding project photos.</p> : (
          <div className="photo-grid">
            {(selectedFolder.photos || []).map((photo) => (
              <article key={photo.id} className="photo-card">
                <button className="photo-card-image" onClick={() => setExpandedPhoto({ name: photo.name, path: photo.markupPath || photo.path, previewType: 'image' })}>
                  {photo.markupThumbnailPath || photo.thumbnailPath
                    ? <StoredImage path={photo.markupThumbnailPath || photo.thumbnailPath} alt={photo.name} />
                    : <span>Preview loading</span>}
                </button>
                <strong>{photo.name}</strong>
                <textarea value={photo.note || ''} onChange={(event) => updatePhoto(photo.id, { note: event.target.value })} placeholder="Photo note" />
                <div className="row-actions">
                  <button className="ghost" onClick={() => downloadPhoto(photo)}>Download</button>
                  <PhotoMarkupButton photo={photo} projectId={project.id} onSave={(patch) => updatePhoto(photo.id, patch)} />
                  <button className="ghost danger-button" onClick={() => removePhoto(photo.id)}>Delete</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      {expandedPhoto && <ExpandedPartFileModal file={expandedPhoto} onClose={() => setExpandedPhoto(null)} />}
    </div>
  );
}

function ProjectInstructionsTab({ project, parts, categories, onUpdate, onCreatePart }) {
  const [newPart, setNewPart] = useState({ name: '', quantity: 1, categoryId: 'cat-unassigned' });
  const [linkPart, setLinkPart] = useState({ partId: '', quantity: 1 });
  const photos = (project.photoFolders || []).flatMap((folder) => (folder.photos || []).map((photo) => ({ ...photo, folderName: folder.name })));
  const linkedParts = project.partIds.map((id) => parts.find((part) => part.id === id)).filter(Boolean);
  const availableParts = parts.filter((part) => !project.partIds.includes(part.id));
  const instructions = project.instructions || { intro: '', steps: [] };

  const updateInstructions = (patch) => onUpdate({ instructions: { ...instructions, ...patch } });
  const updateStep = (stepId, patch) => updateInstructions({
    steps: instructions.steps.map((step) => step.id === stepId ? { ...step, ...patch } : step),
  });

  const addStep = () => {
    updateInstructions({
      steps: [
        ...instructions.steps,
        { id: makeId('instruction-step'), title: `Step ${instructions.steps.length + 1}`, body: '', photoId: '' },
      ],
    });
  };

  const createInstructionPart = () => {
    if (!newPart.name.trim()) return;
    onCreatePart(project.id, newPart);
    setNewPart({ name: '', quantity: 1, categoryId: 'cat-unassigned' });
  };

  const linkInstructionPart = () => {
    if (!linkPart.partId) return;
    onUpdate({
      partIds: [...project.partIds, linkPart.partId],
      partQuantities: { ...(project.partQuantities || {}), [linkPart.partId]: Number(linkPart.quantity) || 1 },
    });
    setLinkPart({ partId: '', quantity: 1 });
  };

  return (
    <div className="instructions-layout">
      <section className="panel instruction-intro-panel">
        <h3>Intro</h3>
        <RichTextEditor value={instructions.intro || ''} onChange={(intro) => updateInstructions({ intro })} onUploadImage={(file) => saveRichTextImageSource(file, `project-instructions/${project.id}/intro`)} placeholder="Introduce the build, tools, safety notes, and final result..." />
      </section>
      <section className="panel instruction-parts-panel">
        <h3>Parts List</h3>
        <div className="instruction-parts-list">
          {linkedParts.map((part) => (
            <div key={part.id} className="instruction-part-row">
              <span>{part.name}</span>
              <strong>Qty {Number(project.partQuantities?.[part.id]) || 1}</strong>
            </div>
          ))}
        </div>
        <div className="instruction-link-part">
          <select value={linkPart.partId} onChange={(event) => setLinkPart((current) => ({ ...current, partId: event.target.value }))}>
            <option value="">Link part from library</option>
            {availableParts.map((part) => <option key={part.id} value={part.id}>{part.name}</option>)}
          </select>
          <input type="number" min="1" value={linkPart.quantity} onChange={(event) => setLinkPart((current) => ({ ...current, quantity: Number(event.target.value) || 1 }))} />
          <button onClick={linkInstructionPart} disabled={!linkPart.partId}>Link Part</button>
        </div>
        <div className="instruction-new-part">
          <input value={newPart.name} onChange={(event) => setNewPart((current) => ({ ...current, name: event.target.value }))} placeholder="Create and link part" />
          <input type="number" min="1" value={newPart.quantity} onChange={(event) => setNewPart((current) => ({ ...current, quantity: Number(event.target.value) || 1 }))} />
          <select value={newPart.categoryId} onChange={(event) => setNewPart((current) => ({ ...current, categoryId: event.target.value }))}>
            {flattenCategoryOptions(categories).map((category) => <option key={category.id} value={category.id}>{category.fullLabel}</option>)}
          </select>
          <button onClick={createInstructionPart}>Add Part</button>
        </div>
      </section>
      <section className="panel wide">
        <div className="section-title">
          <h3>Steps</h3>
          <button onClick={addStep}>{instructions.steps.length ? 'Add Another Step' : 'Add Step 1'}</button>
        </div>
        <div className="instruction-steps">
          {instructions.steps.map((step, index) => {
            const photo = photos.find((item) => item.id === step.photoId);
            return (
              <article key={step.id} className="instruction-step-card">
                <div className="instruction-step-number">Step {index + 1}</div>
                <input value={step.title || ''} onChange={(event) => updateStep(step.id, { title: event.target.value })} placeholder="Step header" />
                <select value={step.photoId || ''} onChange={(event) => updateStep(step.id, { photoId: event.target.value })}>
                  <option value="">No linked photo</option>
                  {photos.map((item) => <option key={item.id} value={item.id}>{item.folderName} / {item.name}</option>)}
                </select>
                {photo && <div className="instruction-step-photo"><StoredImage path={photo.markupPath || photo.path} alt={photo.name} /></div>}
                <RichTextEditor value={step.body || ''} onChange={(body) => updateStep(step.id, { body })} onUploadImage={(file) => saveRichTextImageSource(file, `project-instructions/${project.id}/steps`)} placeholder="Write this step like an Instructables build step..." />
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

const TEXT_EXTENSIONS = ['.txt', '.md', '.json', '.ino', '.cpp', '.c', '.h', '.hpp', '.py', '.js', '.ts', '.tsx', '.jsx', '.html', '.css'];
const SHELL_THUMBNAIL_EXTENSIONS = ['.sldprt', '.sldasm', '.slddrw', '.dwg', '.step', '.stp'];
const EXTERNAL_VIEWER_MESSAGES = {
  '.dwg': 'DWG preview is not available inline. Open this file in a CAD app.',
  '.step': 'STEP preview is not available inline yet. Open this file in your 3D/CAD app.',
  '.stp': 'STEP preview is not available inline yet. Open this file in your 3D/CAD app.',
  '.xls': 'Excel preview is not available inline yet. Open this spreadsheet in Excel or export it as CSV for preview.',
};

function linkOwnerInfo() {
  const config = currentSyncConfig();
  return {
    deviceId: config.deviceId || 'local',
    deviceName: config.deviceName || (config.mode === 'host' ? 'Host computer' : 'This computer'),
  };
}

function linkedOwnerIsThisComputer(file) {
  if (file?.storageMode !== 'link') return true;
  if (!file.linkedOwnerDeviceId) return !isHostSyncClient();
  return file.linkedOwnerDeviceId === linkOwnerInfo().deviceId;
}

function linkedOwnerLabel(file) {
  if (file?.storageMode !== 'link') return '';
  const owner = linkedOwnerIsThisComputer(file) ? linkOwnerInfo().deviceName : file.linkedOwnerDeviceName;
  return `Linked on ${owner || 'another computer'}`;
}

function fileDownloadPath(file) {
  if (!file) return '';
  if (file.storageMode === 'link' && !linkedOwnerIsThisComputer(file)) return file.baselinePath || file.path || '';
  return file.path || file.baselinePath || '';
}

async function cloneLinkedFolderSnapshot(projectId, trackerId, trackedItemId, folderName, files) {
  const snapshotFiles = await Promise.all((files || []).map(async (child) => {
    const relativePath = child.relativePath || child.name || 'file';
    const library = `project-files/${projectId}/${trackerId}/linked-baseline/${trackedItemId}/${folderName}/${relativePath.split('/').slice(0, -1).join('/')}`;
    const bytes = await readStoredFile(child.path, child.clientLocal === true);
    const stored = await saveBytesFile(relativePath.split('/').pop() || child.name || 'file', library, bytes);
    const hash = await fileHash(stored.path).catch(() => '');
    return {
      ...child,
      baselinePath: stored.path,
      baselineHash: hash,
      baselineSize: stored.size,
      contentHash: child.contentHash || hash,
    };
  }));
  return snapshotFiles;
}

function integrityLabel(status) {
  if (status === 'changed') return 'Outdated';
  if (status === 'missing') return 'Missing';
  if (status === 'ok') return 'OK';
  return '';
}

async function downloadStoredProjectFile(file) {
  if (!file || (!fileDownloadPath(file) && file.type !== 'folder')) return;
  if (file.type === 'folder') {
    const entries = await Promise.all((file.folderFiles || []).map(async (child) => ({
      name: child.relativePath || child.name,
      data: await readStoredFile(file.storageMode === 'link' && !linkedOwnerIsThisComputer(file) ? child.baselinePath || child.path : child.path),
    })));
    downloadBytes(`${safeName(file.name)}.zip`, createZip(entries), 'application/zip');
    return;
  }
  const bytes = await readStoredFile(fileDownloadPath(file), file.storageMode === 'link' && linkedOwnerIsThisComputer(file));
  downloadBytes(file.name, bytes, 'application/octet-stream');
}

const PROJECT_THUMBNAIL_PREFIX = 'buildbook-project-thumb:';

async function createImageThumbnailDataUrl(path, width = 480, height = 270) {
  const bytes = await readStoredFile(path);
  const blob = new Blob([bytes], { type: imageMimeType(path) });
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.fillStyle = cssColor('--surface-raised', '#30373f');
  context.fillRect(0, 0, width, height);
  const scale = Math.max(width / bitmap.width, height / bitmap.height);
  const drawWidth = bitmap.width * scale;
  const drawHeight = bitmap.height * scale;
  context.drawImage(bitmap, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  bitmap.close?.();
  return canvas.toDataURL('image/jpeg', 0.74);
}

function ProjectThumbnail({ path, alt = '' }) {
  const cacheKey = path ? `${PROJECT_THUMBNAIL_PREFIX}${path}` : '';
  const [src, setSrc] = useState(() => {
    if (!cacheKey) return '';
    try {
      return localStorage.getItem(cacheKey) || '';
    } catch {
      return '';
    }
  });

  useEffect(() => {
    if (!path) {
      setSrc('');
      return undefined;
    }

    let active = true;
    const cached = (() => {
      try {
        return localStorage.getItem(cacheKey) || '';
      } catch {
        return '';
      }
    })();
    if (cached) {
      setSrc(cached);
      return undefined;
    }

    createImageThumbnailDataUrl(path)
      .then((dataUrl) => {
        if (!active) return;
        try {
          localStorage.setItem(cacheKey, dataUrl);
        } catch {
          // Ignore storage quota; the generated thumbnail still works this session.
        }
        setSrc(dataUrl);
      })
      .catch(() => {
        if (active) setSrc(isHostSyncClient() ? '' : assetUrl(path));
      });

    return () => {
      active = false;
    };
  }, [path, cacheKey]);

  if (!src) return null;
  return <img src={src} alt={alt} draggable={false} />;
}

function ProjectPartsTab({
  project,
  parts,
  categories,
  projects,
  storageLocations = [],
  onUpdate,
  onUpdatePart,
  onUpdatePartStorage,
  onCreateCategory,
  onLinkProject,
  onUnlinkProject,
  onProjectQuantityChange,
  onDuplicatePart,
  onDeletePart,
}) {
  const [selectedPart, setSelectedPart] = useState(null);
  const [editingPartId, setEditingPartId] = useState('');
  const [linkingPart, setLinkingPart] = useState(false);
  const thumbnailJobsRef = useRef(new Set());
  const linkedParts = project.partIds.map((id) => parts.find((part) => part.id === id)).filter(Boolean);

  useEffect(() => {
    if (!selectedPart) return;
    const refreshed = parts.find((part) => part.id === selectedPart.id);
    if (refreshed && refreshed !== selectedPart) setSelectedPart(refreshed);
  }, [parts, selectedPart]);

  useEffect(() => {
    if (isHostSyncClient()) return undefined;
    const missing = linkedParts.filter((part) => part.image && !part.imageThumbnail && !thumbnailJobsRef.current.has(part.id));
    if (!missing.length) return undefined;
    return runWhenIdle(() => {
      missing.slice(0, 2).forEach((part) => {
        thumbnailJobsRef.current.add(part.id);
        savePhotoThumbnailFromPath(part.image, part.name, `part-images/${part.id}/thumbs`)
          .then((thumbnail) => onUpdatePart(part.id, { imageThumbnail: thumbnail.path }))
          .catch((error) => console.warn('Could not create part thumbnail', error))
          .finally(() => thumbnailJobsRef.current.delete(part.id));
      });
    });
  }, [linkedParts, onUpdatePart]);

  const linkPart = (partId) => {
    if (!partId || project.partIds.includes(partId)) return;
    onUpdate({
      partIds: [...project.partIds, partId],
      partQuantities: { ...(project.partQuantities || {}), [partId]: project.partQuantities?.[partId] || 1 },
    });
    setLinkingPart(false);
  };

  const unlinkPart = (partId) => {
    const nextQuantities = { ...(project.partQuantities || {}) };
    delete nextQuantities[partId];
    onUpdate({ partIds: project.partIds.filter((id) => id !== partId), partQuantities: nextQuantities });
    setSelectedPart((part) => part?.id === partId ? null : part);
  };

  const updatePartQuantity = (partId, quantity) => {
    const safeQuantity = Math.max(0, Number(quantity) || 0);
    onUpdate({ partQuantities: { ...(project.partQuantities || {}), [partId]: safeQuantity } });
  };

  return (
    <div className="parts-workspace">
      <div>
        <div className="section-toolbar">
          <button onClick={() => setLinkingPart(true)}>Link Part</button>
        </div>
        {linkedParts.length === 0 ? <section className="panel empty-panel">No parts linked yet.</section> : (
          <div className="linked-part-grid">
            {linkedParts.map((part) => (
              <button key={part.id} className="linked-part-card" onClick={() => setSelectedPart(part)}>
                <div className="part-image">{part.image ? <PartPreviewImage part={part} /> : part.name.slice(0, 2).toUpperCase()}</div>
                <strong>{part.name}</strong>
                <span>{categoryLabel(categories, part.categoryId)}</span>
                <small>{part.storageLocation || 'No location set'}</small>
              </button>
            ))}
          </div>
        )}
      </div>
      <section className="panel build-parts-card">
        <div className="section-title">
          <h2>Build Parts</h2>
        </div>
        {linkedParts.length ? (
          <div className="project-part-qty-list">
            {linkedParts.map((part) => (
              <div key={part.id} className="project-part-qty-row">
                <span className="project-part-qty-name">{part.name}</span>
                <div className="qty-stepper">
                  <input
                    type="number"
                    min="0"
                    value={project.partQuantities?.[part.id] ?? 1}
                    onChange={(event) => updatePartQuantity(part.id, event.target.value)}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : <p>Link parts to set project-specific quantities.</p>}
      </section>
      {selectedPart && (
        <PartInfoModal
          part={selectedPart}
          categories={categories}
          onClose={() => setSelectedPart(null)}
          onUnlink={unlinkPart}
          onEdit={(partId) => {
            setSelectedPart(null);
            setEditingPartId(partId);
          }}
          onUpdatePart={onUpdatePart}
        />
      )}
      {editingPartId && parts.find((part) => part.id === editingPartId) && (
        <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && setEditingPartId('')}>
          <div className="modal part-library-modal">
            <PartEditor
              part={parts.find((part) => part.id === editingPartId)}
              categories={categories}
              projects={projects}
              storageLocations={storageLocations}
              onClose={() => setEditingPartId('')}
              onUpdate={(patch) => onUpdatePart(editingPartId, patch)}
              onStorageChange={(selection) => onUpdatePartStorage(editingPartId, selection)}
              onLinkProject={onLinkProject}
              onUnlinkProject={onUnlinkProject}
              onProjectQuantityChange={onProjectQuantityChange}
              onDuplicate={() => {
                const target = parts.find((part) => part.id === editingPartId);
                if (target) onDuplicatePart(target);
              }}
              onDelete={async () => {
                const deleted = await onDeletePart(editingPartId);
                if (deleted !== false) setEditingPartId('');
              }}
            />
          </div>
        </div>
      )}
      {linkingPart && (
        <LinkPartModal
          parts={parts}
          linkedIds={project.partIds}
          categories={categories}
          onLink={linkPart}
          onClose={() => setLinkingPart(false)}
          renderPartImage={(part) => <PartPreviewImage part={part} />}
        />
      )}
    </div>
  );
}

function ProjectFilesTab({ project, template, revisionSettings, onUpdate }) {
  const [fileTrackerId, setFileTrackerId] = useState(template.fileTrackers[0]?.id || '');
  const [fileUploadNotes, setFileUploadNotes] = useState('');
  const [stagedAttachment, setStagedAttachment] = useState(null);
  const [fileError, setFileError] = useState('');
  const [fileBusy, setFileBusy] = useState(false);
  const [fileNotice, setFileNotice] = useState('');
  const [editSessions, setEditSessions] = useState({});
  const [selectedFileId, setSelectedFileId] = useState('');
  const [viewerScope, setViewerScope] = useState('latest');
  const [expandedFileGroups, setExpandedFileGroups] = useState({});
  const [replaceTargetFileId, setReplaceTargetFileId] = useState('');
  const autoIntegrityBusyRef = useRef(false);
  const editSessionsRef = useRef({});
  const hostSyncClient = isHostSyncClient();
  const projectFilesRef = useRef(project.files);
  const effectiveRevisionSettings = useMemo(
    () => projectRevisionSettings(project, revisionSettings),
    [project, revisionSettings],
  );

  useEffect(() => {
    projectFilesRef.current = project.files;
  }, [project.files]);

  useEffect(() => {
    editSessionsRef.current = editSessions;
  }, [editSessions]);

  useEffect(() => {
    const refreshCheckouts = () => {
      const paths = [...new Set(Object.values(editSessionsRef.current).map((session) => session.checkoutPath).filter(Boolean))];
      paths.forEach((path) => fileCheckout(path, 'heartbeat').catch(() => {}));
    };
    const timer = window.setInterval(refreshCheckouts, 30000);
    return () => {
      window.clearInterval(timer);
      const paths = [...new Set(Object.values(editSessionsRef.current).map((session) => session.checkoutPath).filter(Boolean))];
      paths.forEach((path) => fileCheckout(path, 'release').catch(() => {}));
    };
  }, [project.id]);

  const trackedItemKey = (file) => file.trackedItemId || file.id;
  const replaceTargetFile = project.files.find((file) => file.id === replaceTargetFileId) || null;
  const applyFileUpdate = async (nextFiles, options = {}) => {
    const { files, deletedPaths } = pruneTrackedFiles(nextFiles, effectiveRevisionSettings);
    onUpdate({ files });
    if (options.selectFileId) setSelectedFileId(options.selectFileId);
    if (deletedPaths.length) {
      try {
        await deleteManagedFiles(deletedPaths);
      } catch (error) {
        setFileError(String(error));
      }
    }
    return files;
  };
  const clearTrackedItemStorage = async (targetFiles) => {
    const deletePaths = [...new Set(targetFiles.flatMap((file) => fileHistoryPaths(file)))];
    if (deletePaths.length) {
      try {
        await deleteManagedFiles(deletePaths);
      } catch (error) {
        setFileError(String(error));
      }
    }
  };

  const attachProjectFile = async (pickedFile = null, linkedPath = '') => {
    const trackerId = replaceTargetFile?.trackerId || fileTrackerId;
    const tracker = template.fileTrackers.find((item) => item.id === trackerId);
    const trimmedPath = linkedPath.trim();
    if ((!trimmedPath && !pickedFile) || !tracker) return;

    const candidateName = pickedFile?.name || trimmedPath;
    if (!extensionAllowed(candidateName, tracker.extensions)) {
      setFileError(`This tracker only accepts: ${tracker.extensions}`);
      return;
    }

    setFileBusy(true);
    setFileError('');
    try {
      const owner = linkOwnerInfo();
      const stored = pickedFile
        ? await savePickedFile(pickedFile, `project-files/${project.id}/${tracker.id}`)
        : linkedLocalFile(trimmedPath);
      const contentHash = stored.path ? await fileHash(stored.path, !pickedFile && isHostSyncClient()).catch(() => '') : '';
      let baselinePath = '';
      let baselineHash = '';
      let baselineSize = 0;
      if (!pickedFile && trimmedPath) {
        const baseline = await saveBytesFile(
          stored.name,
          `project-files/${project.id}/${tracker.id}/linked-baseline`,
          await readStoredFile(trimmedPath, isHostSyncClient()),
        );
        baselinePath = baseline.path;
        baselineHash = await fileHash(baseline.path).catch(() => '');
        baselineSize = baseline.size || 0;
      }
      const trackedItemId = replaceTargetFile ? trackedItemKey(replaceTargetFile) : makeId('tracked-file');
      const baseFiles = replaceTargetFile
        ? project.files.map((file) => trackedItemKey(file) === trackedItemId ? { ...file, latest: false } : file)
        : project.files;
      await applyFileUpdate([
        ...baseFiles,
        {
          id: makeId('file'),
          trackedItemId,
          trackerId: tracker.id,
          name: stored.name,
          path: stored.path,
          sourcePath: pickedFile ? '' : trimmedPath,
          storageMode: pickedFile ? 'copy' : 'link',
          linkedOwnerDeviceId: pickedFile ? '' : owner.deviceId,
          linkedOwnerDeviceName: pickedFile ? '' : owner.deviceName,
          size: stored.size,
          contentHash,
          baselinePath,
          baselineHash,
          baselineSize,
          latest: true,
          notes: fileUploadNotes.trim(),
          createdAt: new Date().toISOString(),
        },
      ]);
      setFileUploadNotes('');
      setStagedAttachment(null);
      setReplaceTargetFileId('');
    } catch (error) {
      setFileError(String(error));
    } finally {
      setFileBusy(false);
    }
  };

  const selectLinkedProjectFile = async () => {
    setFileBusy(true);
    setFileError('');
    try {
      const selectedPath = await pickLinkedFilePath();
      if (selectedPath) setStagedAttachment({ type: 'link-file', path: selectedPath });
    } catch (error) {
      setFileError(String(error));
    } finally {
      setFileBusy(false);
    }
  };

  const selectLinkedProjectFolder = async () => {
    setFileBusy(true);
    setFileError('');
    try {
      const selectedPath = await pickLinkedFolderPath();
      if (selectedPath) setStagedAttachment({ type: 'link-folder', path: selectedPath });
    } catch (error) {
      setFileError(String(error));
    } finally {
      setFileBusy(false);
    }
  };

  const attachProjectFolder = async (pickedFiles = []) => {
    const trackerId = replaceTargetFile?.trackerId || fileTrackerId;
    const tracker = template.fileTrackers.find((item) => item.id === trackerId);
    const allPickedFiles = [...pickedFiles];
    const hasExtensionFilter = Boolean((tracker?.extensions || '').split(',').map((item) => item.trim()).filter(Boolean).length);
    const files = hasExtensionFilter ? allPickedFiles.filter((file) => extensionAllowed(file.name, tracker?.extensions || '')) : allPickedFiles;
    if (!tracker || !files.length) {
      setFileError(tracker?.extensions ? `No files in that folder match: ${tracker.extensions}` : 'No files found in that folder.');
      return;
    }

    setFileBusy(true);
    setFileError('');
    try {
      const now = new Date().toISOString();
      const firstPath = files[0]?.webkitRelativePath || files[0]?.name || 'Folder upload';
      const folderName = firstPath.split('/').filter(Boolean)[0] || 'Folder upload';
      const storedFiles = await Promise.all(files.map(async (file) => {
        const relativePath = file.webkitRelativePath || file.name;
        const relativeParts = relativePath.split('/').filter(Boolean);
        const childRelativePath = relativeParts.length > 1 ? relativeParts.slice(1).join('/') : file.name;
        const folderParts = childRelativePath.split('/').slice(0, -1);
        const library = ['project-files', project.id, tracker.id, folderName, ...folderParts].join('/');
        const stored = await savePickedFile(file, library);
        const contentHash = stored.path ? await fileHash(stored.path).catch(() => '') : '';
        return {
          id: makeId('folder-file'),
          name: relativeParts.length > 1 ? relativePath : stored.name,
          relativePath: childRelativePath,
          path: stored.path,
          size: stored.size,
          contentHash,
        };
      }));
      const folderRecord = {
        id: makeId('file'),
        trackedItemId: replaceTargetFile ? trackedItemKey(replaceTargetFile) : makeId('tracked-file'),
        trackerId: tracker.id,
        type: 'folder',
        name: folderName,
        path: '',
        sourcePath: '',
        storageMode: 'copy',
        size: storedFiles.reduce((total, file) => total + (file.size || 0), 0),
        contentHash: '',
        latest: true,
        notes: fileUploadNotes.trim(),
        folderFiles: storedFiles,
        createdAt: now,
      };
      await applyFileUpdate([
        ...(replaceTargetFile
          ? project.files.map((file) => trackedItemKey(file) === trackedItemKey(replaceTargetFile) ? { ...file, latest: false } : file)
          : project.files),
        folderRecord,
      ]);
      setFileUploadNotes('');
      setStagedAttachment(null);
      setReplaceTargetFileId('');
      if (hasExtensionFilter && files.length !== allPickedFiles.length) setFileError(`Uploaded folder "${folderName}" with ${files.length} matching files. Some files did not match this file type.`);
    } catch (error) {
      setFileError(String(error));
    } finally {
      setFileBusy(false);
    }
  };

  const attachLinkedProjectFolder = async (folderPath) => {
    const trackerId = replaceTargetFile?.trackerId || fileTrackerId;
    const tracker = template.fileTrackers.find((item) => item.id === trackerId);
    if (!tracker || !folderPath) return;
    setFileBusy(true);
    setFileError('');
    try {
      const owner = linkOwnerInfo();
      const allFiles = await listLinkedFolderFiles(folderPath);
      const hasExtensionFilter = Boolean((tracker.extensions || '').split(',').map((item) => item.trim()).filter(Boolean).length);
      const files = hasExtensionFilter ? allFiles.filter((file) => extensionAllowed(file.name, tracker.extensions)) : allFiles;
      if (!files.length) {
        setFileError(tracker.extensions ? `No files in that folder match: ${tracker.extensions}` : 'No files found in that folder.');
        return;
      }
      const now = new Date().toISOString();
      const folderName = folderPath.split(/[\\/]/).filter(Boolean).pop() || 'Linked folder';
      let trackedItemId = replaceTargetFile ? trackedItemKey(replaceTargetFile) : makeId('tracked-file');
      let folderFiles = await Promise.all(files.map(async (file) => ({
        id: makeId('folder-file'),
        name: file.relativePath || file.name,
        relativePath: file.relativePath || file.name,
        path: file.path,
        clientLocal: isHostSyncClient(),
        size: file.size || 0,
        contentHash: file.path ? await fileHash(file.path, isHostSyncClient()).catch(() => '') : '',
      })));
      folderFiles = await cloneLinkedFolderSnapshot(project.id, tracker.id, trackedItemId, folderName, folderFiles);
      await applyFileUpdate([
        ...(replaceTargetFile
          ? project.files.map((file) => trackedItemKey(file) === trackedItemKey(replaceTargetFile) ? { ...file, latest: false } : file)
          : project.files),
        {
          id: makeId('file'),
          trackedItemId,
          trackerId: tracker.id,
          type: 'folder',
          name: folderName,
          path: '',
          sourcePath: folderPath,
          storageMode: 'link',
          linkedOwnerDeviceId: owner.deviceId,
          linkedOwnerDeviceName: owner.deviceName,
          size: folderFiles.reduce((total, file) => total + (file.size || 0), 0),
          contentHash: '',
          latest: true,
          notes: fileUploadNotes.trim(),
          folderFiles,
          createdAt: now,
        },
      ]);
      setFileUploadNotes('');
      setStagedAttachment(null);
      setReplaceTargetFileId('');
      if (hasExtensionFilter && files.length !== allFiles.length) setFileError(`Linked folder "${folderName}" with ${files.length} matching files. Some files did not match this file type.`);
    } catch (error) {
      setFileError(String(error));
    } finally {
      setFileBusy(false);
    }
  };

  const loadStagedAttachment = () => {
    if (!stagedAttachment) return;
    if (stagedAttachment.type === 'upload-file') attachProjectFile(stagedAttachment.file);
    if (stagedAttachment.type === 'upload-folder') attachProjectFolder(stagedAttachment.files);
    if (stagedAttachment.type === 'link-file') attachProjectFile(null, stagedAttachment.path);
    if (stagedAttachment.type === 'link-folder') attachLinkedProjectFolder(stagedAttachment.path);
  };

  const beginReplaceFile = (file) => {
    setReplaceTargetFileId(file.id);
    setFileTrackerId(file.trackerId);
    setSelectedFileId(file.id);
  };

  const toggleLatest = (fileId) => {
    const target = project.files.find((file) => file.id === fileId);
    if (!target) return;
    const targetItemKey = trackedItemKey(target);
    onUpdate({
      files: project.files.map((file) =>
        file.id === fileId
          ? { ...file, latest: !file.latest }
          : trackedItemKey(file) === targetItemKey && !target.latest
            ? { ...file, latest: false }
            : file,
      ),
    });
  };

  const removeFile = async (fileId) => {
    const target = project.files.find((file) => file.id === fileId);
    if (!target) return;
    const itemKey = trackedItemKey(target);
    const remaining = project.files.filter((file) => file.id !== fileId);
    if (!remaining.some((file) => trackedItemKey(file) === itemKey)) {
      await clearTrackedItemStorage(project.files.filter((file) => trackedItemKey(file) === itemKey));
    } else {
      await clearTrackedItemStorage([target]);
    }
    onUpdate({ files: remaining });
  };
  const updateFile = (fileId, patch) => onUpdate({ files: project.files.map((file) => file.id === fileId ? { ...file, ...patch } : file) });
  const integrityCheckable = (file) => Boolean(file.path || file.type === 'folder') && (file.storageMode !== 'link' || linkedOwnerIsThisComputer(file));
  const autoIntegrityCheckable = (file) => file.latest && integrityCheckable(file);
  const visibleIntegrityStatus = (file) => (file.latest && ['changed', 'missing'].includes(file.integrityStatus) ? file.integrityStatus : '');
  const comparisonHash = (item) => item.baselineHash || item.contentHash || '';
  const checkAttachmentIntegrity = async (file) => {
    if (!integrityCheckable(file)) return;
    try {
      if (file.type === 'folder') {
        const checkedChildren = await Promise.all((file.folderFiles || []).map(async (child) => {
          try {
            const currentHash = await fileHash(child.path, file.storageMode === 'link' && isHostSyncClient());
            return {
              ...child,
              contentHash: child.contentHash || currentHash,
              integrityStatus: comparisonHash(child) && currentHash !== comparisonHash(child) ? 'changed' : 'ok',
              integrityCheckedAt: new Date().toISOString(),
            };
          } catch {
            return { ...child, integrityStatus: 'missing', integrityCheckedAt: new Date().toISOString() };
          }
        }));
        const statuses = checkedChildren.map((child) => child.integrityStatus);
        updateFile(file.id, {
          folderFiles: checkedChildren,
          integrityStatus: statuses.includes('missing') ? 'missing' : statuses.includes('changed') ? 'changed' : 'ok',
          integrityCheckedAt: new Date().toISOString(),
        });
        return;
      }

      const currentHash = await fileHash(file.path, file.storageMode === 'link' && isHostSyncClient());
      updateFile(file.id, {
        contentHash: file.contentHash || currentHash,
        integrityStatus: comparisonHash(file) && currentHash !== comparisonHash(file) ? 'changed' : 'ok',
        integrityCheckedAt: new Date().toISOString(),
      });
    } catch {
      updateFile(file.id, { integrityStatus: 'missing', integrityCheckedAt: new Date().toISOString() });
    }
  };

  const acceptCurrentFileVersion = async (file) => {
    if (!integrityCheckable(file)) return;
    try {
      if (file.storageMode === 'link') {
        const snapshot = await saveLinkedRevisionSnapshot(file);
        await applyFileUpdate(project.files.map((item) => item.id === file.id ? snapshot.latest : item).concat(snapshot.revision));
        if (snapshot.cleanupPaths.length) await deleteManagedFiles(snapshot.cleanupPaths);
        return;
      }
      if (file.type === 'folder') {
        const checkedChildren = await Promise.all((file.folderFiles || []).map(async (child) => {
          const currentHash = await fileHash(child.path, file.storageMode === 'link' && isHostSyncClient());
          return {
            ...child,
            contentHash: currentHash,
            baselineHash: currentHash,
            integrityStatus: 'ok',
            integrityCheckedAt: new Date().toISOString(),
          };
        }));
        updateFile(file.id, {
          folderFiles: checkedChildren,
          integrityStatus: 'ok',
          integrityCheckedAt: new Date().toISOString(),
        });
        return;
      }
      const currentHash = await fileHash(file.path, file.storageMode === 'link' && isHostSyncClient());
      updateFile(file.id, {
        contentHash: currentHash,
        baselineHash: currentHash,
        integrityStatus: 'ok',
        integrityCheckedAt: new Date().toISOString(),
      });
    } catch {
      updateFile(file.id, { integrityStatus: 'missing', integrityCheckedAt: new Date().toISOString() });
    }
  };

  const saveLinkedRevisionSnapshot = async (file, now = new Date()) => {
    const nextRevisionCheckAt = effectiveRevisionSettings.delayEnabled
      ? new Date(now.getTime() + effectiveRevisionSettings.delayMinutes * 60000).toISOString()
      : '';
    if (file.type === 'folder') {
      const liveFiles = await listLinkedFolderFiles(file.sourcePath || '');
      const matchingFiles = await Promise.all(liveFiles.map(async (child) => ({
        id: makeId('folder-file'),
        name: child.relativePath || child.name,
        relativePath: child.relativePath || child.name,
        path: child.path,
        clientLocal: file.storageMode === 'link' && isHostSyncClient(),
        size: child.size || 0,
        contentHash: child.path ? await fileHash(child.path, isHostSyncClient()).catch(() => '') : '',
      })));
      const snapshotFiles = await cloneLinkedFolderSnapshot(project.id, file.trackerId, trackedItemKey(file), file.name, matchingFiles);
      return {
        cleanupPaths: [...new Set((file.folderFiles || []).map((child) => child.baselinePath).filter(Boolean))],
        latest: {
          ...file,
          folderFiles: snapshotFiles,
          size: matchingFiles.reduce((total, child) => total + (child.size || 0), 0),
          integrityStatus: 'ok',
          integrityCheckedAt: now.toISOString(),
          nextRevisionCheckAt,
        },
        revision: {
          ...file,
          id: makeId('file'),
          latest: false,
          storageMode: 'copy',
          sourcePath: '',
          path: '',
          folderFiles: snapshotFiles.map((child) => ({
            ...child,
            path: child.baselinePath,
            contentHash: child.baselineHash || child.contentHash,
          })),
          createdAt: now.toISOString(),
          notes: withLatestVersionNote(file.notes, now),
        },
      };
    }

    const bytes = await readStoredFile(file.path, file.storageMode === 'link' && isHostSyncClient());
    const stored = await saveBytesFile(file.name, fileLibrary(file), bytes);
    const baseline = await saveBytesFile(file.name, `${fileLibrary(file)}/linked-baseline`, bytes);
    const currentHash = await fileHash(baseline.path).catch(() => file.contentHash || '');
    return {
      cleanupPaths: file.baselinePath ? [file.baselinePath] : [],
      latest: {
        ...file,
        contentHash: currentHash,
        baselinePath: baseline.path,
        baselineHash: currentHash,
        baselineSize: baseline.size || 0,
        integrityStatus: 'ok',
        integrityCheckedAt: now.toISOString(),
        nextRevisionCheckAt,
      },
      revision: {
        ...file,
        id: makeId('file'),
        latest: false,
        storageMode: 'copy',
        sourcePath: '',
        path: stored.path,
        size: stored.size,
        contentHash: currentHash,
        baselinePath: '',
        baselineHash: '',
        baselineSize: 0,
        createdAt: now.toISOString(),
        notes: withLatestVersionNote(file.notes, now),
      },
    };
  };

  const checkAllAttachmentIntegrity = async () => {
    const currentFiles = projectFilesRef.current;
    if (autoIntegrityBusyRef.current || !currentFiles.some(autoIntegrityCheckable)) return;
    autoIntegrityBusyRef.current = true;
    try {
      let nextFiles = [...currentFiles];
      const appended = [];
      const cleanupPaths = [];
      for (const file of currentFiles) {
        if (!autoIntegrityCheckable(file)) continue;
        if (file.nextRevisionCheckAt && Date.parse(file.nextRevisionCheckAt) > Date.now()) continue;
        try {
          if (file.type === 'folder') {
            const checkedChildren = await Promise.all((file.folderFiles || []).map(async (child) => {
              try {
                const currentHash = await fileHash(child.path, file.storageMode === 'link' && isHostSyncClient());
                return {
                  ...child,
                  contentHash: child.contentHash || currentHash,
                  integrityStatus: comparisonHash(child) && currentHash !== comparisonHash(child) ? 'changed' : 'ok',
                  integrityCheckedAt: new Date().toISOString(),
                };
              } catch {
                return { ...child, integrityStatus: 'missing', integrityCheckedAt: new Date().toISOString() };
              }
            }));
            const statuses = checkedChildren.map((child) => child.integrityStatus);
            const changed = statuses.includes('changed');
            if (file.storageMode === 'link' && changed) {
              const snapshot = await saveLinkedRevisionSnapshot({ ...file, folderFiles: checkedChildren });
              nextFiles = nextFiles.map((item) => item.id === file.id ? snapshot.latest : item);
              if (effectiveRevisionSettings.trackLinkedFiles) appended.push(snapshot.revision);
              cleanupPaths.push(...snapshot.cleanupPaths);
            } else {
              nextFiles = nextFiles.map((item) => item.id === file.id ? {
                ...file,
                folderFiles: checkedChildren,
                integrityStatus: statuses.includes('missing') ? 'missing' : changed ? 'changed' : 'ok',
                integrityCheckedAt: new Date().toISOString(),
              } : item);
            }
            continue;
          }
          const currentHash = await fileHash(file.path, file.storageMode === 'link' && isHostSyncClient());
          const changed = Boolean(comparisonHash(file) && currentHash !== comparisonHash(file));
          if (file.storageMode === 'link' && changed) {
            const snapshot = await saveLinkedRevisionSnapshot({ ...file, contentHash: file.contentHash || currentHash });
            nextFiles = nextFiles.map((item) => item.id === file.id ? snapshot.latest : item);
            if (effectiveRevisionSettings.trackLinkedFiles) appended.push(snapshot.revision);
            cleanupPaths.push(...snapshot.cleanupPaths);
          } else {
            nextFiles = nextFiles.map((item) => item.id === file.id ? {
              ...file,
              contentHash: file.contentHash || currentHash,
              integrityStatus: changed ? 'changed' : 'ok',
              integrityCheckedAt: new Date().toISOString(),
            } : item);
          }
        } catch {
          nextFiles = nextFiles.map((item) => item.id === file.id ? { ...file, integrityStatus: 'missing', integrityCheckedAt: new Date().toISOString() } : item);
        }
      }
      if (appended.length) await applyFileUpdate(nextFiles.concat(appended));
      else onUpdate({ files: nextFiles });
      if (cleanupPaths.length) await deleteManagedFiles([...new Set(cleanupPaths)]);
    } finally {
      autoIntegrityBusyRef.current = false;
    }
  };

  useEffect(() => {
    checkAllAttachmentIntegrity();
    const timer = window.setInterval(checkAllAttachmentIntegrity, 60000);
    return () => window.clearInterval(timer);
  }, [project.id]);
  const downloadProjectFile = async (file) => {
    try {
      setFileError('');
      setFileNotice('');
      await downloadStoredProjectFile(file);
      setFileNotice(`${file.type === 'folder' ? 'Folder' : 'File'} downloaded: ${file.name}`);
    } catch (error) {
      setFileError(String(error));
    }
  };
  const fileLibrary = (file) => `project-files/${project.id}/${file.trackerId}`;
  const beginEdit = async (file) => {
    if (file.storageMode === 'link' && !linkedOwnerIsThisComputer(file)) {
      await downloadProjectFile(file);
      return;
    }
    if (file.type === 'folder') {
      setSelectedFileId(file.id);
      return;
    }
    if (!file.path) return;
    setFileBusy(true);
    setFileError('');
    let checkoutPath = '';
    try {
      if (file.storageMode !== 'link') {
        const checkout = await fileCheckout(file.path, 'acquire');
        if (!checkout.acquired) {
          throw new Error(checkout.message || `This file is checked out by ${checkout.lease?.deviceName || 'another computer'}.`);
        }
        checkoutPath = file.path;
        if (checkout.offline) setFileNotice(checkout.message);
      }
      const editable = file.storageMode === 'link'
        ? { name: file.name, path: file.path, size: file.size || 0, clientLocal: isHostSyncClient() }
        : await prepareEditableFile(file.path, file.name, `${fileLibrary(file)}/working/${file.id}`);
      const baseHash = editable.baseHash || await fileHash(editable.path, editable.clientLocal === true);
      if (editable.pending) {
        setFileNotice(`${file.name} has unsynchronized edits in this computer's working copy.`);
      }

      setEditSessions((current) => ({
        ...current,
        [file.id]: {
          path: editable.path,
          baseHash,
          name: file.name,
          trackerId: file.trackerId,
          trackedItemId: trackedItemKey(file),
          sourcePath: file.storageMode === 'link' ? file.path : '',
          clientLocal: editable.clientLocal === true,
          checkoutPath,
        },
      }));
      await openStoredFile(editable.path, editable.clientLocal === true);
    } catch (error) {
      if (checkoutPath) fileCheckout(checkoutPath, 'release').catch(() => {});
      setFileError(String(error));
    } finally {
      setFileBusy(false);
    }
  };

  const checkFileChanges = async (file, providedSession = editSessions[file.id], options = {}) => {
    if (!providedSession?.path) return false;
    try {
      if (file.nextRevisionCheckAt && Date.parse(file.nextRevisionCheckAt) > Date.now()) return false;
      const currentHash = await fileHash(providedSession.path, providedSession.clientLocal === true);
      if (currentHash === providedSession.baseHash) {
        if (!options.quiet) setFileError(`No saved changes found for ${file.name}.`);
        return false;
      }

      if (file.storageMode === 'link') {
        const now = new Date();
        const snapshot = await saveLinkedRevisionSnapshot(file, now);
        await applyFileUpdate(project.files.map((item) => item.id === file.id ? snapshot.latest : item).concat(snapshot.revision));
        if (snapshot.cleanupPaths.length) await deleteManagedFiles(snapshot.cleanupPaths);
        setEditSessions((current) => ({
          ...current,
          [file.id]: {
            ...providedSession,
            baseHash: currentHash,
          },
        }));
        if (!options.quiet) setFileError(`Updated linked file status for ${file.name}.`);
        return true;
      }

      const bytes = await readStoredFile(providedSession.path, providedSession.clientLocal === true);
      const now = new Date().toISOString();
      if (providedSession.versionFileId && providedSession.versionPath) {
        const stored = await overwriteBytesFile(providedSession.versionPath, bytes, file.name);
        const sessionItemKey = providedSession.trackedItemId || trackedItemKey(file);
        onUpdate({
          files: project.files.map((item) =>
            item.id === providedSession.versionFileId
              ? {
                ...item,
                path: stored.path,
                size: stored.size,
                contentHash: currentHash,
                latest: true,
                notes: withLatestVersionNote(item.notes || file.notes, new Date(now)),
                createdAt: now,
              }
              : trackedItemKey(item) === sessionItemKey
                ? { ...item, latest: false }
                : item,
          ),
        });
        setEditSessions((current) => ({
          ...current,
          [file.id]: {
            ...providedSession,
            baseHash: currentHash,
            versionPath: stored.path,
          },
        }));
        if (!options.quiet) setFileError(`Updated ${file.name} in the current edit session.`);
        return true;
      }

      const stored = await saveBytesFile(file.name, fileLibrary(file), bytes);
      let nextCheckoutPath = providedSession.checkoutPath || '';
      if (providedSession.checkoutPath && providedSession.checkoutPath !== stored.path) {
        await fileCheckout(providedSession.checkoutPath, 'release').catch(() => {});
        const checkout = await fileCheckout(stored.path, 'acquire');
        nextCheckoutPath = checkout.acquired ? stored.path : '';
      }
      const newFileId = makeId('file');
      const newFile = {
        ...file,
        id: newFileId,
        trackedItemId: trackedItemKey(file),
        path: stored.path,
        sourcePath: providedSession.sourcePath || file.sourcePath || '',
        storageMode: 'copy',
        size: stored.size,
        contentHash: currentHash,
        latest: true,
        notes: withLatestVersionNote(file.notes, new Date(now)),
        createdAt: now,
      };
      const itemKey = trackedItemKey(file);
      const resetFiles = project.files.map((item) => trackedItemKey(item) === itemKey ? { ...item, latest: false } : item);
      await applyFileUpdate([
        ...resetFiles,
        newFile,
      ], { selectFileId: newFileId });
      setEditSessions((current) => {
        const next = { ...current };
        delete next[file.id];
        next[newFileId] = {
          ...providedSession,
          baseHash: currentHash,
          name: file.name,
          trackerId: file.trackerId,
          trackedItemId: itemKey,
          versionFileId: newFileId,
          versionPath: stored.path,
          checkoutPath: nextCheckoutPath,
        };
        return next;
      });
      if (!options.quiet) setFileError(`Saved ${file.name} as a new latest version.`);
      return true;
    } catch (error) {
      if (!options.quiet) setFileError(String(error));
      return false;
    }
  };

  useEffect(() => {
    const onFocus = () => {
      Object.entries(editSessions).forEach(([fileId, session]) => {
        const file = project.files.find((item) => item.id === fileId);
        if (file) checkFileChanges(file, session, { quiet: true });
      });
    };

    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [editSessions, project.files]);

  const sortFiles = (files) => [...files].sort((a, b) => {
    if (a.latest !== b.latest) return a.latest ? -1 : 1;
    const dateA = Date.parse(a.createdAt || '') || 0;
    const dateB = Date.parse(b.createdAt || '') || 0;
    return dateB - dateA || a.name.localeCompare(b.name);
  });
  const grouped = template.fileTrackers.map((tracker) => ({
    tracker,
    files: sortFiles(project.files.filter((file) => file.trackerId === tracker.id)),
  })).filter((group) => group.files.length);
  const latestFiles = sortFiles(project.files.filter((file) => file.latest));
  const allFiles = grouped.flatMap((group) => group.files);
  const viewerFiles = viewerScope === 'latest' ? latestFiles : allFiles;
  const selectedFile = viewerFiles.find((file) => file.id === selectedFileId) || viewerFiles[0] || null;
  const previewSelectedFile = selectedFile && selectedFile.storageMode === 'link' && !linkedOwnerIsThisComputer(selectedFile)
    ? { ...selectedFile, path: fileDownloadPath(selectedFile), sourcePath: '' }
    : selectedFile;
  const selectedFileTracker = selectedFile ? template.fileTrackers.find((tracker) => tracker.id === selectedFile.trackerId) : null;
  const selectedExtension = fileExtension(selectedFile?.name || '');
  const fullViewerExtensions = new Set(['.pdf', '.stl', '.obj', '.dxf', ...TEXT_EXTENSIONS]);
  const viewerMode = selectedFile && (selectedFile.type === 'folder' || fullViewerExtensions.has(selectedExtension)) ? 'full' : 'compact';
  const fileBusyLabel = fileBusy ? 'Working on file operation...' : '';
  const stagedAttachmentName = stagedAttachment?.type === 'upload-file'
    ? stagedAttachment.file?.name
    : stagedAttachment?.type === 'upload-folder'
      ? stagedAttachment.files?.[0]?.webkitRelativePath?.split('/')[0] || stagedAttachment.files?.[0]?.name
      : stagedAttachment?.path?.split(/[\\/]/).filter(Boolean).pop();

  useEffect(() => {
    if (!selectedFile) {
      setSelectedFileId('');
      return;
    }
    if (!selectedFileId || !viewerFiles.some((file) => file.id === selectedFileId)) setSelectedFileId(selectedFile.id);
  }, [project.files, selectedFile, selectedFileId, viewerFiles]);

  return (
    <div className="files-workspace">
      <div className="file-list-pane">
        <section className="panel upload-card">
          <div className="upload-type-row">
            <select value={fileTrackerId} onChange={(event) => { setFileTrackerId(event.target.value); setReplaceTargetFileId(''); }}>
              {template.fileTrackers.map((tracker) => (
                <option key={tracker.id} value={tracker.id}>
                  {tracker.name}{tracker.extensions ? ` (${tracker.extensions})` : ''}
                </option>
              ))}
            </select>
            <input value={fileUploadNotes} onChange={(event) => setFileUploadNotes(event.target.value)} placeholder="Upload notes" />
          </div>
          {replaceTargetFile && (
            <div className="replace-file-notice">
              <span>Changing: {replaceTargetFile.name}</span>
              <button className="ghost" onClick={() => setReplaceTargetFileId('')}>Cancel Change</button>
            </div>
          )}
          <div className="upload-action-row">
            <div className="upload-buttons">
              <label className={`file-picker compact-picker upload-method ${stagedAttachment?.type === 'upload-file' ? 'selected' : ''}`}>
                <input
                  type="file"
                  accept={acceptFromExtensions(template.fileTrackers.find((tracker) => tracker.id === fileTrackerId)?.extensions || '')}
                  onChange={(event) => {
                    const pickedFile = event.target.files?.[0];
                    if (pickedFile) setStagedAttachment({ type: 'upload-file', file: pickedFile });
                    event.target.value = '';
                  }}
                />
                Upload File
              </label>
              <label className={`file-picker compact-picker upload-method ${stagedAttachment?.type === 'upload-folder' ? 'selected' : ''}`}>
                <input
                  type="file"
                  multiple
                  webkitdirectory=""
                  directory=""
                  onChange={(event) => {
                    const files = Array.from(event.target.files || []);
                    if (files.length) setStagedAttachment({ type: 'upload-folder', files });
                    event.target.value = '';
                  }}
                />
                Upload Folder
              </label>
              <button className={`upload-method ${stagedAttachment?.type === 'link-file' ? 'selected' : ''}`} onClick={selectLinkedProjectFile} disabled={fileBusy}>Link File</button>
              <button className={`upload-method ${stagedAttachment?.type === 'link-folder' ? 'selected' : ''}`} onClick={selectLinkedProjectFolder} disabled={fileBusy}>Link Folder</button>
            </div>
            <button className={stagedAttachment ? '' : 'secondary'} onClick={loadStagedAttachment} disabled={fileBusy || !stagedAttachment}>
              {fileBusy ? 'Loading...' : stagedAttachment?.type?.includes('folder') ? 'Load Folder' : 'Load File'}
            </button>
          </div>
          {hostSyncClient && <p className="settings-note">Linked files stay live only on the computer that linked them. Other computers receive downloadable snapshots.</p>}
          {stagedAttachment && (
            <div className="staged-attachment">
              <span title={stagedAttachmentName}>{stagedAttachmentName || 'Selected file'}</span>
              <button className="ghost" onClick={() => setStagedAttachment(null)}>Clear</button>
            </div>
          )}
          <BusyNotice label={fileBusyLabel} />
          {fileError && <p className="error-text">{fileError}</p>}
          {fileNotice && <p className="success-text">{fileNotice}</p>}
        </section>

        {grouped.length === 0 ? <section className="panel empty-panel">No files attached yet.</section> : grouped.map(({ tracker, files }) => {
          const expanded = !!expandedFileGroups[tracker.id];
          const latestInGroup = files.filter((file) => file.latest);
          const visibleFiles = expanded ? files : (latestInGroup.length ? latestInGroup : files.slice(0, 1));
          const olderCount = Math.max(0, files.length - visibleFiles.length);
          const hasHiddenFiles = files.length > (latestInGroup.length ? latestInGroup.length : 1);
          const latestIsLinked = (latestInGroup.length ? latestInGroup : files.slice(0, 1)).some((file) => file.storageMode === 'link');
          return (
          <section key={tracker.id} className="panel file-group">
            <div className="file-group-header">
              <div className="file-group-title-row">
                <h3>{tracker.name}</h3>
                {latestIsLinked && <span className="linked-status">Linked</span>}
              </div>
              <div className="file-group-actions">
                {hasHiddenFiles && (
                  <button
                    className="ghost"
                    onClick={() => setExpandedFileGroups((current) => ({ ...current, [tracker.id]: !current[tracker.id] }))}
                  >
                    {expanded ? 'Collapse' : 'Show all'}
                  </button>
                )}
              </div>
            </div>
            <div className="file-table">
              {visibleFiles.map((file) => (
                <div key={file.id} className="file-row">
                  <div className="file-row-left">
                    {(fileDownloadPath(file) || file.type === 'folder') && (
                      isRemoteBuildBookClient() || (file.storageMode === 'link' && !linkedOwnerIsThisComputer(file))
                        ? <button className="file-link-button" onClick={() => downloadProjectFile(file)} disabled={fileBusy}>Download</button>
                        : <button className="file-link-button" onClick={() => { setSelectedFileId(file.id); beginEdit(file); }} disabled={fileBusy}>Open</button>
                    )}
                    {!isRemoteBuildBookClient() && !(file.storageMode === 'link' && !linkedOwnerIsThisComputer(file)) && (fileDownloadPath(file) || file.type === 'folder') && <button className="file-download-button" onClick={() => downloadProjectFile(file)}>Download</button>}
                    <strong>{file.type === 'folder' ? `${file.name}, ${(file.folderFiles || []).length} files` : file.name}</strong>
                    {linkedOwnerLabel(file) && <span className="linked-owner-label">{linkedOwnerLabel(file)}</span>}
                    <div className="file-note-field">
                      <span>Note:</span>
                      <p>{file.notes || ''}</p>
                    </div>
                  </div>
                  <div className="file-row-right">
                    {visibleIntegrityStatus(file) && <span className={`integrity-pill ${file.integrityStatus}`}>{integrityLabel(file.integrityStatus)}</span>}
                    <span className="file-date">{file.createdAt ? new Date(file.createdAt).toLocaleDateString() : ''}</span>
                    {file.latest && <button className="ghost" onClick={() => beginReplaceFile(file)}>Change</button>}
                    <button className={file.latest ? 'latest-pill' : 'mark-latest-button'} onClick={() => { toggleLatest(file.id); setSelectedFileId(file.id); }}>{file.latest ? 'Latest' : 'Mark Latest'}</button>
                    <button className="file-delete-button" onClick={() => removeFile(file.id)} aria-label={`Delete ${file.name}`}>x</button>
                  </div>
                  {(file.path || file.type === 'folder' || editSessions[file.id] || tracker.programPath) && (
                    <div className="file-extra-actions">
                      {file.latest && file.integrityStatus === 'changed' && <button className="ghost" onClick={() => acceptCurrentFileVersion(file)}>Update</button>}
                      {file.path && tracker.programPath && linkedOwnerIsThisComputer(file) && <button className="ghost" onClick={() => openWithProgram(tracker.programPath, file.path)}>Launch</button>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
          );
        })}
      </div>
      <section className={`panel file-viewer-card ${viewerMode === 'compact' ? 'compact-viewer' : 'full-viewer'}`}>
        <div className="section-title">
          <h2>File Viewer</h2>
          <div className="viewer-scope-toggle">
            <button className={viewerScope === 'latest' ? 'active' : ''} onClick={() => setViewerScope('latest')}>Latest Files</button>
            <button className={viewerScope === 'all' ? 'active' : ''} onClick={() => setViewerScope('all')}>All Files</button>
          </div>
          {selectedFile?.path && selectedFileTracker?.programPath && linkedOwnerIsThisComputer(selectedFile) && <button className="ghost" onClick={() => openWithProgram(selectedFileTracker.programPath, selectedFile.path)}>Launch</button>}
        </div>
        {selectedFile ? (
          <>
            <select value={selectedFile.id} onChange={(event) => setSelectedFileId(event.target.value)}>
              {viewerFiles.map((file) => (
                <option key={file.id} value={file.id}>
                  {fileTrackerLabel(template.fileTrackers, file.trackerId)} - {file.name}
                </option>
              ))}
            </select>
            <div className="file-viewer-meta">
              <strong>{fileTrackerLabel(template.fileTrackers, selectedFile.trackerId)}</strong>
              <span>{selectedFile.name}</span>
            </div>
            <FilePreview file={previewSelectedFile} />
          </>
        ) : <p>No files available to preview yet.</p>}
      </section>
    </div>
  );
}

export default Projects;
