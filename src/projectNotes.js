export function projectNoteSheets(project) {
  const sheets = Array.isArray(project.noteSheets) && project.noteSheets.length
    ? project.noteSheets
    : [{ id: 'project-notes', title: 'Project Notes', content: project.notes || '' }];
  return sheets.map((sheet, index) => ({
    id: sheet.id || `note-sheet-${index + 1}`,
    title: String(sheet.title || (index === 0 ? 'Project Notes' : `Notes ${index + 1}`)).trim() || (index === 0 ? 'Project Notes' : `Notes ${index + 1}`),
    content: String(sheet.content ?? sheet.notes ?? ''),
  }));
}
