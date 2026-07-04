# BuildBook Architecture and Contributor Guide

This is the starting point for programmers and AI coding agents working in the
BuildBook desktop repository. Read it with the root `AGENTS.md`, which contains
mandatory compatibility rules.

## Product Purpose

BuildBook is a Windows-first application for maintaining the working record of
electronics, fabrication, and hardware projects. Its core domain is:

- Projects with notes, checklists, tags, instructions, and photos
- A reusable parts library with categories, documents, and storage locations
- Project file tracking with latest-version selection and revision retention
- Supplier order imports
- Portable project export and full-workspace backup
- Optional browser access and host/client synchronization

BuildBook manages records and file references. It does not replace CAD,
firmware, spreadsheet, image-editing, or document-authoring applications.

## Coordinated Repositories

BuildBook behavior is distributed across:

- `BuildBook`: Windows desktop application
- `BuildBook_Web`: containerized web application
- `BuildBook_Compatibility_Standards`: portable interchange authority

The standards repository is authoritative for import/export, backup/restore,
portable manifests, asset paths, capability flags, and large-file restore
behavior.

Do not create a desktop-only portable contract. Shared manifest or portable
asset changes must be defined in the standards repository first and may require
coordinated desktop and web updates.

## Technology

- React 18 and plain JavaScript modules
- Vite 5
- Tauri 2
- Rust for persistence, filesystem access, LAN serving, and synchronization
- JSON state plus managed filesystem assets

## Entry Points

Frontend:

- `src/main.jsx` mounts React and imports global styles.
- `src/App.jsx` owns loading, saving, authentication, connection state,
  top-level routing, and conflict presentation.
- `src/AppViews.jsx` is the stable view-export facade.

Desktop:

- `src-tauri/src/main.rs` calls the library entry point.
- `src-tauri/src/lib.rs` configures Tauri plugins, the tray, window-close
  behavior, and the command registry.

## Runtime Modes

### Tauri standalone or host

`storage.js` calls Tauri commands to read and write local state. Host mode uses
the same authoritative state while serving clients.

### Tauri client

The device configuration has `mode: "client"`. State loads and saves through
host synchronization commands. The client keeps merge-base, conflict, and file
cache data.

### LAN browser client

The React bundle is served by Rust. `storage.js` uses HTTP API routes such as
`/api/state` instead of Tauri commands.

### Vite browser development

On Vite's development origin, state falls back to browser `localStorage`. This
is useful for UI work but does not exercise native filesystem behavior.

Runtime detection and shared request headers live in `src/runtime.js`.

## Frontend Structure

Application shell:

- `App.jsx`: bootstrapping, persistence, login, connection status, and routing
- `AppViews.jsx`: stable top-level view exports
- `sharedUi.jsx`: headers, busy state, and stored-image rendering
- `ConfirmDialog.jsx`: confirmation provider

Feature views:

- `ProjectsView.jsx`: project list and project workspace
- `PartsView.jsx`: parts library, categories, editor, and details
- `ImportsView.jsx`: supplier import batches and review
- `SearchView.jsx`: cross-workspace search
- `SettingsView.jsx`: workspace, maintenance, network, and synchronization
- `FilePreview.jsx`: file preview selection and rendering

Focused dialogs include `ThemeEditorModal.jsx`, `TemplatePreviewModal.jsx`,
`ProjectImportReview.jsx`, `SyncConflictReviewModal.jsx`, `LinkPartModal.jsx`,
and `NoteImageMarkupModal.jsx`.

Domain modules:

- `data.js`: default state, normalization, identifiers, and labels
- `storage.js`: runtime-aware state load/save
- `desktop.js`: frontend wrappers around native and host-file commands
- `theme.js`: editable fields, derived colors, and CSS variables
- `revisionHelpers.js`: retention, pruning, and tracked storage
- `projectNotes.js` and `projectNoteHelpers.js`: note sheets
- `richText*.js`: rich-text policy, storage, sanitization, and images
- `files.js`, `fileHash.js`, and `filePreviewParsers.js`: file utilities
- `supplierImport.js`: supplier parsing and normalization
- `searchHelpers.js`: shared workspace and Parts Library search used by the
  Search view and AI retrieval tools
- `projectAi.js`: device-local AI profiles, provider adapters, tool loop,
  project memory, audit history, and chat persistence
- `projectAiTools.js`: BuildBook environment manifest, permission-filtered AI
  tool schemas, project retrieval, and draft-only write proposals

Compatibility modules:

- `compatibility.js`
- `compatibilityProjectPackage.js`
- `compatibilityWebProject.js`
- `compatibilityBackup.js`
- `compatibilityAssets.js`
- `compatibilityNotes.js`
- `zip.js`

Apply the compatibility gate in `AGENTS.md` before editing these modules.

## Rust Backend Structure

`lib.rs` keeps Tauri setup and command registration small. Three implementation
files share the crate-root namespace so Tauri command symbols and tightly
coupled LAN/sync helpers remain stable:

- `sync.rs`: device configuration, pairing, synchronization, conflict handling,
  host-file operations, discovery, and sync tests
- `lan_server.rs`: browser authentication, routing, LAN APIs, static serving,
  and server lifecycle
- `local_files.rs`: managed uploads, editable copies, URL downloads, file
  pickers, reads, and external opening

Focused Rust modules:

- `state.rs`: state validation, atomic writes, and snapshots
- `storage.rs`: managed storage scanning, cleanup, and folder enumeration
- `file_access.rs`: path normalization, private-path guards, and OS opening
- `lan.rs`: HTTP parsing and response helpers
- `thumbnails.rs`: Windows shell thumbnails

When adding a Tauri command:

1. Put it in the owning Rust source file.
2. Add it to `tauri::generate_handler!` in `lib.rs`.
3. Add or update its wrapper in `src/desktop.js`.
4. Verify success and failure behavior in the owning runtime mode.

## State Model

`DEFAULT_STATE` and `normalizeState` in `src/data.js` define in-memory state.
Major fields are:

- `version`
- `closeToTray`
- `lanServer`
- `webAuth`
- `theme`
- `categories`
- `template`
- `revisionSettings`
- `storageLocations`
- `projects`
- `parts`
- `importBatches`

Normalization fills defaults, repairs optional arrays and objects, normalizes
storage references, and preserves forward fields through object spreading where
possible. Do not bypass it when loading external or persisted state.

## Persistence and Managed Files

The backend resolves the application-data directory through Tauri. Important
contents are:

- `buildbook-state.json`: standalone/host state
- `buildbook-device.json`: device and sync configuration
- `buildbook-sync-base.json`: client merge base
- `buildbook-sync-conflict.json`: conflict host snapshot
- `state-backups/`: recent and weekly state snapshots
- `uploads/`: managed project and library assets
- `working/`: editable and cached working files

State writes validate a JSON-object root, write and flush a temporary file, and
replace the prior state under a process lock.

The application distinguishes managed files, externally linked files, and
client cache files. Private state and device files must never be exposed through
user file actions or LAN file APIs.

## Save Flow

1. `App.jsx` loads through `loadAppState`.
2. `storage.js` selects Tauri, sync client, LAN browser, or localStorage.
3. Loaded state passes through `normalizeState`.
4. Views call the application `updateState` callback.
5. `App.jsx` serializes saves and tracks connection status.
6. The selected runtime persists locally or sends changes to the host.

Avoid feature-specific direct state writes.

## Synchronization

One host is authoritative. Clients pair with a temporary code and receive
per-device credentials.

Synchronization tracks host revision, the common base, pending local changes,
connection status, conflict snapshots, and file checkout leases.

Independent entity changes can merge. Conflicting values require review.
Project note conflicts receive special handling to avoid silently discarding
text. Linked paths are computer-owned and must not be assumed to exist on
another device.

## LAN Server

The Rust server provides the built React application and APIs for state,
authentication, synchronization, files, downloads, storage, and status.

Mutating requests require the BuildBook request header. Routes also apply the
appropriate token, session, paired-device, host allow-list, and private-path
checks.

Direct LAN access is for trusted networks, not public exposure. Read
`SECURITY.md` before changing authentication or network behavior.

## Compatibility Rules

Stop and check the standards repository before changing:

- Project import/export
- Full backup/restore
- Portable manifest names or fields
- Archive asset paths or reference semantics
- Portable photos, notes, instructions, documents, or revision history
- Capability flags
- Chunked or resumable restore behavior

Preserve unknown valid forward-compatible fields. Do not silently drop
unsupported valid data.

## Security Invariants

- Never serve private state or configuration files as user assets.
- Canonicalize filesystem paths before checking allowed roots.
- Constrain destructive file actions to managed storage roots.
- Keep URL-download validation and blocked-address checks intact.
- Keep application headers on mutating LAN routes.
- Do not weaken token, session, pairing, or per-device checks.
- Do not expose the direct LAN server as an internet-grade service.

## Development and Validation

Install and run:

```powershell
npm install
npm run tauri dev
```

Frontend-only development:

```powershell
npm run dev
```

Validation:

```powershell
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
git diff --check
```

For UI changes, exercise the affected workflow in Tauri. Vite browser testing
does not cover native files, Windows thumbnails, tray behavior, updates, or
desktop synchronization.

## Where to Make Common Changes

- Projects: `ProjectsView.jsx`
- Parts and categories: `PartsView.jsx`, `categoryHelpers.js`
- Imports: `ImportsView.jsx`, `supplierImport.js`
- Settings and network UI: `SettingsView.jsx`
- Themes: `theme.js`, `ThemeEditorModal.jsx`
- State defaults and normalization: `data.js`
- Runtime persistence: `storage.js`
- Native command wrappers: `desktop.js`
- Native files: `local_files.rs`, `file_access.rs`
- LAN HTTP behavior: `lan_server.rs`, `lan.rs`
- Sync and conflicts: `sync.rs`
- Storage cleanup: `storage.rs`
- Portable packages and backups: compatibility modules, after standards review

## Rules for Programmers and AI Agents

1. Read `AGENTS.md` and this guide before editing.
2. Inspect current implementation before proposing abstractions.
3. Keep changes inside the owning feature boundary.
4. Preserve unknown state and portable fields where supported.
5. Do not revert unrelated worktree changes.
6. Add tests in proportion to behavioral risk.
7. Run relevant tests, builds, formatting, and whitespace checks.
8. Report validation that could not be run.
9. Update this guide when ownership, runtime modes, or invariants change.
