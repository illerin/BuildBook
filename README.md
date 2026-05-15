# BuildBook

Version: 0.3.10

BuildBook is the Windows desktop rewrite of the electronics project documentation tracker. The current Docker/web prototype remains in `../PartTrack`; this folder is the clean Tauri-based desktop app.

## Goals

- Desktop-first project documentation for electronics builds.
- Local project files that can later be opened in native tools like Arduino IDE, CAD tools, slicers, and PDF readers.
- Project sharing through portable export/import packages.
- Read-only web/mobile companion mode in a later phase.

## Current State

This is the initial Tauri + React scaffold with a working app shell:

- Projects workspace
- Parts library
- Imports review area
- Settings/planning area
- Local JSON app state with Tauri-backed desktop file handling

## Development

Prerequisites:

- Node.js
- Rust
- Tauri prerequisites for Windows

Commands:

```powershell
npm install
npm run dev
npm run tauri dev
```

Build:

```powershell
npm run tauri build
```
