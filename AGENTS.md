# BuildBook Desktop Repo Instructions

This repo is one of three coordinated repos:
- Desktop app: C:\Users\Work\Documents\GitHub\BuildBook
- Web app: C:\Users\Work\Documents\GitHub\BuildBook_Web
- Compatibility standards: C:\Users\Work\Documents\GitHub\BuildBook_Compatibility_Standards

Compatibility authority:
- The shared source of truth for import/export, backup/restore, portable manifest fields, capability flags, and large-file restore protocol is:
  C:\Users\Work\Documents\GitHub\BuildBook_Compatibility_Standards
- Do not invent or change shared compatibility behavior ad hoc in this repo.

Compatibility gate:
Treat any change touching any of the following as a compatibility change:
- project export or import
- full backup or restore
- buildbook-package.json
- buildbook-backup.json
- backup.json
- project-manifest.json
- project-data.json
- portable manifest field names
- asset archive paths
- asset reference semantics
- project photo, instruction, note-image, part-document, or file-history portability
- capability flags
- chunked/resumable restore protocol

Required behavior:
- Before implementing a compatibility change, first check the standards repo.
- If the requested behavior is not already covered by the standards repo, explicitly say that the standards must be updated.
- If a user asks for a change that would alter the shared contract, do not silently implement it as desktop-only behavior if it affects portable interchange.
- If the standards and current app behavior conflict, surface the conflict clearly.
- If backward compatibility would be broken, say so explicitly and ask whether the shared standard should change.

Development expectations:
- Prefer importing or copying shared compatibility constants, fixtures, and validators from the standards repo rather than duplicating logic.
- Keep unknown forward-compatible portable fields preserved on import/export whenever possible.
- Do not silently drop unsupported but valid portable fields.
- If preservation is not possible, fail explicitly.

When to ask explicitly:
- A manifest field must be renamed, removed, or reinterpreted.
- A required portable field is being added.
- Asset layout inside export/backup zips is changing.
- A new capability flag is needed.
- The large-file restore protocol is changing.
- A change would require both Desktop and Web to update in lockstep.
