# BuildBook Web Parity Checklist

The desktop app is currently ahead of the web app. Keep these areas aligned so project exports and full backups can move both directions without data loss.

- Import and export `buildbook-backup.json`, `backup.json`, `buildbook-package.json`, `project-manifest.json`, and `project-data.json`.
- Preserve unknown valid portable fields instead of dropping them.
- Preserve project notes, note images, project photos, photo thumbnails, markups, instructions, linked parts, part quantities, part documents, file trackers, file history, latest-file flags, and storage/category settings.
- Restore project photo folders and thumbnails from portable packages.
- Keep child categories and category order when restoring.
- Support tracked-file matching by tracker id, name, and extensions.
- Treat linked desktop paths as non-portable in project exports; export the current file/folder contents as portable files.
- Use capability flags when a format feature is unsupported.
- Run desktop compatibility smoke checks before release and web round-trip tests before changing package fields.
