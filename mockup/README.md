# BuildBook Layout Studio

This prototype is isolated from the production application. It uses in-memory
sample data and does not import BuildBook state, call Tauri commands, or write
to BuildBook storage.

Run the repository Vite server:

```powershell
npm run dev
```

Open:

```text
http://127.0.0.1:5173/mockup/
```

The Layout Studio controls the five-color palette, density, sidebar width, list
row height, corner radius, section treatment, and thumbnails. **Copy settings**
places the current prototype settings on the clipboard for use in a later
production implementation.

Projects and Parts Library both include **Cards** and **List** view toggles. The
sidebar, system font stack, and base type sizes mirror the live desktop app.
