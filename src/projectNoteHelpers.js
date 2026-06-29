export function notesPatchFromSheets(sheets) {
  const normalized = sheets.length ? sheets : [{ id: 'project-notes', title: 'Project Notes', content: '' }];
  return { noteSheets: normalized, notes: normalized[0]?.content || '' };
}
