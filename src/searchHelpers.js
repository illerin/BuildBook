import { categoryLabel, fileTrackerLabel } from './data.js';
import { projectNoteSheets } from './projectNotes.js';

function searchable(value) {
  return String(value || '').toLowerCase();
}

function matchesQuery(query, ...values) {
  const phrase = searchable(query).trim();
  if (!phrase) return true;
  return values.map(searchable).join(' ').includes(phrase);
}

function matchesTerms(query, ...values) {
  const terms = searchable(query).trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const text = values.map(searchable).join(' ');
  return terms.every((term) => text.includes(term));
}

export function searchWorkspace(state, query, options = {}) {
  const limit = options.limit == null ? Number.MAX_SAFE_INTEGER : Math.max(1, Number(options.limit) || 50);
  const projectId = options.projectId || '';
  const projects = projectId ? state.projects.filter((project) => project.id === projectId) : state.projects;
  return {
    projects: projects.filter((project) => matchesQuery(
      query,
      project.name,
      project.status,
      project.notes,
      ...projectNoteSheets(project).flatMap((sheet) => [sheet.title, sheet.content]),
      ...(project.nextSteps || []).map((step) => step.text || step),
    )).slice(0, limit),
    parts: state.parts.filter((part) => matchesQuery(
      query,
      part.name,
      categoryLabel(state.categories, part.categoryId),
      part.storageLocation,
      part.specSummary,
      part.notes,
      part.productUrl,
    )).slice(0, limit),
    files: projects.flatMap((project) => project.files.map((file) => ({
      ...file,
      projectName: project.name,
      projectId: project.id,
      trackerName: fileTrackerLabel(state.template.fileTrackers, file.trackerId),
    }))).filter((file) => matchesQuery(query, file.name, file.notes, file.trackerName, file.projectName)).slice(0, limit),
    documents: state.parts.flatMap((part) => part.documents.map((document) => ({
      ...document,
      partName: part.name,
      partId: part.id,
    }))).filter((document) => matchesQuery(query, document.name, document.type, document.partName)).slice(0, limit),
    imports: state.importBatches.flatMap((batch) => (batch.items || []).map((item) => ({
      ...item,
      batchName: batch.name || batch.fileName || batch.id,
    }))).filter((item) => matchesQuery(query, item.raw?.name, item.name, item.batchName, item.status)).slice(0, limit),
  };
}

export function searchParts(parts, categories, query, limit = 20) {
  return parts.filter((part) => matchesTerms(
    query,
    part.name,
    categoryLabel(categories, part.categoryId),
    part.storageLocation,
    part.specSummary,
    part.notes,
    part.productUrl,
    ...(part.documents || []).map((document) => document.name),
  )).slice(0, Math.max(1, Math.min(100, Number(limit) || 20)));
}
