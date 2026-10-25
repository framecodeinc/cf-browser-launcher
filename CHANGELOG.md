# Change Log
 
All notable changes to the "ColdFusion Browser Launcher" extension will be documented in this file.

---
 
## [1.1.7] - 2026-10-25
 
### Added
 
- **Debug ColdFusion File in Default Browser** and **Debug ColdFusion File in...**: debug a file with
  Adobe's debugger and open the page in the browser you choose, instead of always using the
  operating system's default browser. They need the Adobe ColdFusion Builder extension.
- Run and debug options for `.cfc` files, besides `.cfm`.
- The run and debug options are also in the right-click menu inside the editor.
- **CF Browser Launcher: Show Log** command, with a short log of what the debug launcher does.
- **CF Browser Launcher: Forget Remembered Projects** command. When you debug a file, the extension
  finds its ColdFusion project from your workspace; for a project that isn't open there, Adobe asks
  once and the extension remembers the answer. This command clears what was remembered.
- Built-in browser paths for macOS and Linux, in addition to the Windows ones that were already there.
### Changed
 
- The run commands are now named **Run ColdFusion File in Default Browser** and
  **Run ColdFusion File in...**, matching the debug ones.
### Fixed
 
- File or folder names with spaces, `#`, `%`, `?`, `&` or accents now produce a valid URL.
- "Run ColdFusion File in Default Browser" opens the page through VS Code instead of
  `cmd /c start`, which failed with some characters on Windows, and now works the same on every platform.

## [1.0.6] - 2026-08-28

### Changed
 
- Minor improvements and fixes.

---

## [1.0.5] - 2026-08-28

### Changed
 
- Minor improvements and fixes.

---

## [1.0.4] - 2026-08-28

### Changed
 
- Minor improvements and fixes.

---

## [1.0.3] - 2026-08-28

### Changed
 
- Minor improvements and fixes.

---

## [1.0.2] - 2026-08-28

### Changed
 
- Minor improvements and fixes.
 
---
 
## [1.0.1] - 2026-08-28
 
### Added
 
- Initial release of the ColdFusion Browser Launcher.
- Open `.cfm` files against your local Adobe ColdFusion server in a chosen browser without touching your operating system's default browser.