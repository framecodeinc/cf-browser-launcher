# CF Browser Launcher

A minimal VS Code extension that adds two commands when you right-click a `.cfm`
file in the Explorer:

- **Open in Chromium (ColdFusion)** — opens directly in the browser configured as
  `defaultBrowser`.
- **Open in... (ColdFusion)** — shows a picker to choose among the configured
  browsers (similar to WebStorm's browser selector).

It doesn't modify or depend on the Adobe ColdFusion Builder extension; it's fully
independent.

Written in TypeScript (`src/extension.ts`), compiled to `out/extension.js` via `tsc`.

## Development / local testing

```bash
npm install
npm run compile      # or: npm run watch
```

To try it without installing anything, open the project folder in VS Code and press
`F5` (Run > Start Debugging). A second VS Code window opens
("Extension Development Host") with the extension already loaded — that's where you
test the right-click on a `.cfm` file.

## Permanent local install (no Marketplace)

1. Build it (`npm run compile`) to generate `out/extension.js`.
2. Copy the whole `cf-browser-launcher` folder (with `out/` included, no need for
   `src/` or `node_modules/`) into your VS Code extensions folder:

   ```
   %USERPROFILE%\.vscode\extensions\cf-browser-launcher-0.0.1
   ```

3. Restart VS Code. Right-click any `.cfm` file in the Explorer → you'll see the two
   new options.

## Publishing to the Marketplace

1. Replace `YOUR-PUBLISHER-ID` in `package.json` with your real publisher ID (created
   at https://marketplace.visualstudio.com/manage, requires an Azure DevOps
   organization and a Personal Access Token).
2. Also replace the `repository` field with your repo's real URL.
3. Build the package and publish:

   ```bash
   npx vsce login YOUR-PUBLISHER-ID
   npm run package     # generates cf-browser-launcher-0.0.1.vsix (check it before publishing)
   npx vsce publish
   ```

Before publishing, it's worth: adding an icon (`icon` in `package.json`, 128x128+
PNG), refining `categories`/`keywords` so it's easy to find in the Marketplace, and
double-checking that no personal/project-specific defaults remain in the settings
(the `serverBaseUrl` default is already empty for this reason — each user fills in
their own project path).

## Configuration

Go to `Settings` (Ctrl+,) and search for `cfBrowserLauncher`, or edit your
`settings.json`:

```jsonc
{
  "cfBrowserLauncher.serverBaseUrl": "http://localhost:8500/my-project",
  "cfBrowserLauncher.documentRoot": "", // empty = root of the open workspace
  "cfBrowserLauncher.defaultBrowser": "chromium",
  "cfBrowserLauncher.browsers": {
    "chromium": "C:\\Program Files\\Chromium\\Application\\chrome.exe",
    "chrome": "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "edge": "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "firefox": "C:\\Program Files\\Mozilla Firefox\\firefox.exe"
  }
}
```

### About `serverBaseUrl` and `documentRoot`

- If the **workspace you have open in VS Code is exactly the folder the CF server
  maps as your project** (i.e., workspace root = project root in the URL), leave
  `documentRoot` empty and set `serverBaseUrl` to the full URL up to the project name:
  `http://localhost:8500/my-project`.
- If instead you have a **parent folder** open (for example, a workspace containing
  several CF projects, where your project is a subfolder), set `documentRoot` to the
  absolute path of that specific subfolder, and `serverBaseUrl` to
  `http://localhost:8500/my-project` all the same.
- Adjust the browser paths in `browsers` to wherever they're installed on your machine
  (double-check the exact executable path for Chromium/Chrome/Edge/Firefox).

## Notes

- You can assign a keyboard shortcut to either command from `Keyboard Shortcuts`
  (search for `cfBrowserLauncher`).
- If you later want to share it with your team or move it to another machine, it can
  be packaged as a `.vsix` with `vsce package`, but that's not required for personal
  use.
