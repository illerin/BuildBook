# BuildBook

BuildBook is a Windows desktop app for tracking electronics builds, parts, project files, photos, and step-by-step instructions.

## Screenshots

![Project overview](sample%20images/Project%20overview.PNG)

![Parts library](sample%20images/Parts%20Library.PNG)

![Project files](sample%20images/Project%20Files.PNG)

## Install the Windows app

1. Open the [Releases](https://github.com/illerin/BuildBook/releases) page.
2. Download the latest `BuildBook_x64-setup.exe` installer from the newest release.
3. Run the installer.
4. Launch BuildBook from Start Menu or Desktop.

## Update the installed app

1. Open BuildBook.
2. Go to `Settings`.
3. Under `Software Updates`, click `Check for Updates`.
4. If an update is available, click `Install Update`.
5. The app will download the update and restart.

The updater checks GitHub Releases and installs the published Windows build.

## Build from source

### Requirements

- Windows
- Node.js with `npm`
- Rust stable toolchain
- Visual Studio C++ build tools for Windows desktop development

### Run in development

```powershell
npm install
npm run tauri dev
```

### Build an installer

```powershell
npm install
npm run tauri build
```

Build output is written under `src-tauri/target/release/bundle/`. The Windows installer is generated in `src-tauri/target/release/bundle/nsis/`.

## Update a source build

If you are running BuildBook from source and want the latest code:

```powershell
git pull
npm install
npm run tauri build
```

If you are using `npm run tauri dev`, stop the running app and start it again after pulling changes:

```powershell
npm run tauri dev
```

## Notes

- This repo builds the Windows desktop app.
- Release packaging is handled by Tauri and GitHub Actions.
- Published releases are version-matched to `package.json` and `src-tauri/tauri.conf.json`.
