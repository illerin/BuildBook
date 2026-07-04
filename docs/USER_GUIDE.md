# BuildBook User Guide

BuildBook is a Windows desktop application for keeping the working record of an
electronics, fabrication, or hardware project in one place. It connects project
notes, checklists, parts, photos, instructions, and design files without trying
to replace the specialist programs used to create those files.

## Core Concepts

- A **project** is one build and its complete working record.
- A **part** is a reusable library item that can be linked to many projects.
- A **tracked file type** groups project files such as firmware, drawings, or
  3D models and controls their display color and accepted extensions.
- A **latest file** is the preferred version within a tracked file group.
- A **managed file** is copied into BuildBook storage.
- A **linked file** remains at its original path and belongs to the computer
  that can access that path.
- A **host** is the authoritative BuildBook computer in a multi-computer setup.

## Navigation

The main navigation contains:

- **Projects** for active and in-progress builds.
- **Completed Projects** for finished builds.
- **Parts Library** for reusable parts and documents.
- **Search** for records across the workspace.
- **Imports** for supplier order files.
- **Settings** for workspace, maintenance, network, and synchronization options.

## First Setup

1. Open **Settings > Workspace Setup**.
2. Review the project template. New projects receive its default tags and
   checklist entries, and its selected project tabs.
3. Configure the file groups used in your work under **Tracked Files Settings**.
4. Add or organize part categories from the Parts Library.
5. Optionally choose or create a color theme.
6. Create the first project from **Projects > New Project**.

BuildBook saves changes automatically. The save and connection indicator shows
whether data is saved locally, hosted, pending, or in conflict.

## Projects

### Create and organize projects

A project has a name, status, image, active process tags, and the default
checklist from the project template.

Project statuses are `active`, `paused`, `waiting`, `completed`, and `archived`.
The project list can be filtered by status. Completed projects also appear in
the dedicated Completed Projects view.

### Project workspace

Each project contains:

- **Overview**: notes, note sheets, checklist, next steps, and latest files.
- **Instructions**: an introduction, parts list, and ordered build steps.
- **Photos**: folders of project photos with markup support.
- **Parts**: linked library parts and project quantities.
- **Files**: tracked files, revisions, links, and previews.
- **AI Chat**: an optional, project-scoped connection to an OpenAI-compatible
  personal AI system.

The project header controls the image, status, process tags, export, and
deletion. **Configure Tabs** changes the tabs for the current project. The
project template controls the tabs copied into newly created projects. AI Chat
is off by default.

### AI Chat

Enable **AI Chat** in the project template or with **Configure Tabs** inside an
existing project. AI Chat settings have two sections:

- **Connection** stores named, device-local profiles for OpenAI, Anthropic
  Claude, Google Gemini, or an OpenAI-compatible/self-hosted server.
- **Project Access** controls no access, read access, or read/write access for
  Overview, Instructions, Photos, Project Parts, Files, the Parts Library, and
  provider-supported web research.
- **Memory & Audit** stores a short user-controlled project summary and shows
  recent tool calls, errors, responses, and applied changes on the device.

The AI receives a BuildBook environment manifest explaining project tabs,
fields, entity meanings, scope boundaries, and write rules. It retrieves exact
records with permission-checked tools instead of receiving the entire workspace
on every message. Tools can search the Parts Library, inspect a part, search the
current project, read an allowed project section, and read supported text-file
contents. They cannot read other projects.

Photo access sends up to four image files only when a vision-enabled profile is
used and the request appears to require image inspection. Provider web search
requires both the profile capability and project Web Research permission.

Read/write access allows the AI to propose changes. Project changes and new
Parts Library records remain drafts until **Review and Apply** is selected.
New-part drafts include duplicate candidates and can carry evidence URLs,
retrieval dates, specifications, notes, quantity, and optional project linking.
Evidence is retained in the created part's notes.

Each computer or browser can select a different connection profile for the same
project. Profiles, API keys, chat history, and the selected profile stay on that
device and are not synchronized. The OpenAI-compatible option supports servers
such as Ollama, LM Studio, vLLM, llama.cpp, and compatible gateways when their
Chat Completions endpoint permits requests from BuildBook.

Connection profiles also record whether the selected model supports structured
tools, vision input, and provider-managed web search. Turn off unsupported
capabilities for a self-hosted model.

### Notes and instructions

Project notes and instruction text support rich text and embedded images. Notes
can be separated into named sheets. Instructions can include linked parts and
ordered steps.

Instructions can be exported as HTML or opened for printing to PDF. A project
can also be exported as a portable project package.

### Photos

Create photo folders to organize a project. Uploaded photos are stored by
BuildBook. Photo markup creates an edited copy for the project record.

### Parts in a project

Link existing Parts Library items or create a part while working in a project.
Set the quantity required by that project. Editing a library part updates the
shared record used by every linked project.

## Tracked Project Files

Tracked files are grouped by the file types configured under
**Settings > Workspace Setup > Tracked Files Settings**.

Each tracked file type defines:

- A display name
- Accepted file extensions
- A preview category
- An optional external program
- A text color

### Managed files

Uploading or copying a file stores it in BuildBook-managed storage. Managed
files can be included in project exports and full backups.

### Linked files and folders

Linking leaves the source file or folder in place. Use this for files that must
remain in a working directory used by CAD, firmware, or other external tools.

Important linked-file behavior:

- The original path must remain available.
- The link belongs to the computer that created it.
- Other synchronized computers may use downloaded or cached copies, but they do
  not own the original path.
- Full reset does not delete files linked outside BuildBook.
- Portable project exports include supported referenced content according to
  the shared compatibility contract.

### Revisions and latest files

Mark the preferred version as **Latest**. Changing a latest file can preserve
the previous version according to the retention settings.

Tracked Files Settings controls:

- Maximum retained revisions
- Last-N or hybrid retention
- Whether all revisions are retained
- Delayed capture
- Linked-file tracking
- Per-project storage estimates

### Preview and external programs

BuildBook previews supported images, PDFs, text, source code, spreadsheets, and
other recognized formats. Windows shell thumbnails are used for supported
engineering formats when available.

Set an external program on a tracked file type to launch matching files in the
preferred application.

## Parts Library

Parts are reusable records containing:

- Name and category
- Product URL
- Storage container and slot
- Specification summary and notes
- Image
- Documents
- Project usage

Categories can be nested, reordered, renamed, or merged. Deleting a part also
unlinks it from projects after confirmation.

Storage locations are organized as containers and optional slots.

## Supplier Imports

The Imports view accepts supported CSV, text, and PDF supplier files.

1. Import an order or supplier export.
2. Select the new batch.
3. Review each draft item.
4. Choose a category.
5. Create a part, merge into an existing part, or skip the item.
6. Fetch an image when a usable image URL is available.
7. Apply individual items or the complete batch.

Import records can be removed later. When BuildBook can safely identify parts
created by that batch, it can also offer to remove those parts.

## Search

Search covers projects and notes, parts and storage locations, project files,
part documents, and import batches. Selecting a result opens the relevant
top-level area.

## Color Themes

Open **Settings > Workspace Setup > Color Theme**.

The editor exposes the main editable colors on the left and shows colors derived
from each main color on the right. The preview demonstrates application
surfaces, text, accents, statuses, and project tags.

Themes can be exported to JSON and imported on another BuildBook installation.
Derived colors are recalculated from the editable colors.

## Backup, Restore, and Export

### Project export

Use **Export Project** inside a project when sharing or archiving one project.
The export dialog controls which supported project content is included.

### Full backup

Use **Settings > Maintenance > Backup and Restore > Export Backup** to create a
portable workspace backup containing supported state and managed assets.

Before a major upgrade, reset, or storage cleanup:

1. Export a full backup.
2. Keep it outside the BuildBook application-data directory.
3. Confirm the backup file exists before continuing.

Restore replaces workspace data with the selected backup contents. Do not close
BuildBook while export or restore is in progress.

### Automatic state backups

The desktop application keeps recent and weekly state snapshots. These protect
the state document, but a portable full backup is the correct choice when assets
must also be recoverable.

## Storage Maintenance

**Settings > Maintenance > Storage Cleanup** scans managed storage for files no
longer referenced by workspace state.

- Review orphaned files before deletion.
- Open questionable files before selecting them.
- Deletion is permanent.
- Storage cleanup must run on the host in a host/client setup.

## Operating Modes

### Standalone local

The desktop application reads and writes its local state. No other BuildBook
computer is authoritative.

### Host

The host stores authoritative state and serves paired desktop clients. Pairing
codes are temporary. The host can revoke paired devices.

### Connected desktop client

A client loads and saves through the host. It maintains synchronization metadata
and file cache data. Host-controlled network and security settings are read-only
on the client.

If both host and client change the same data, BuildBook may require conflict
review before synchronization can continue.

### Browser access

Local Network Access serves BuildBook to phones or browsers. When enabled, use
the displayed QR code or address from a device that can reach the host.

Keep the access token enabled unless another trusted security layer protects
access. A browser can remember the token after opening the access URL.

## Network Security

BuildBook is intended for trusted personal or workshop networks.

- Do not expose the direct LAN port to the public internet.
- Use a VPN, Tailscale, or an HTTPS reverse proxy for remote access.
- Enable web login for domain or reverse-proxy access.
- Revoke clients that should no longer connect.
- Keep BuildBook and Windows updated.

See [Security Notes](../SECURITY.md) for the current security model and limits.

## Background Operation and Updates

Enable **Keep running in tray** when the host or browser service must remain
available after the main window closes.

Use **Settings > Maintenance > Software Updates** to check for and install a
published update. BuildBook restarts after installing an update.

## Reset

Full Reset deletes BuildBook-managed uploads and returns projects, parts,
categories, and settings to first-install defaults.

It does not delete externally linked files. Export a full backup first. In a
synchronized setup, reset must be started on the host.

## Troubleshooting

### A linked file will not open

- Confirm the file still exists at the recorded path.
- Confirm you are using the computer that owns the link.
- Check the configured external program path.

### A client cannot connect

- Confirm BuildBook is running on the host.
- Confirm both computers can reach each other.
- Verify the host address and pairing code.
- Generate a new pairing code if the old one expired.
- Check firewall and VPN rules for the configured ports.

### Browser access does not load

- Confirm Local Network Access is enabled on the host.
- Use the exact address or QR code shown by the host.
- Confirm the device is on the same reachable network.
- Do not reuse an old address after the host IP or token changes.

### Synchronization reports a conflict

Open conflict review and select the correct value for each conflicting item. Do
not repeatedly overwrite host data without reviewing the differences.

### A preview is unavailable

The file can still be downloaded or opened in its external application. Preview
support depends on format, browser capabilities, and Windows thumbnail support.
