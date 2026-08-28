# Contributing / Local Development

Written in TypeScript (`src/extension.ts`), compiled to `out/extension.js` via `tsc`
(no bundler).

## Setup and build

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
   %USERPROFILE%\.vscode\extensions\cf-browser-launcher-1.0.1
   ```

3. Restart VS Code.

## Publishing to the Marketplace

1. Confirm your publisher ID is registered at
   https://marketplace.visualstudio.com/manage and matches `publisher` in
   `package.json`.
2. Build the package and test it locally first:

   ```bash
   npm run compile
   npm run package     # generates cf-browser-launcher-1.0.1.vsix
   ```

   Install that `.vsix` from the Extensions panel (`...` menu → "Install from
   VSIX...") to verify it works exactly as it will once published.
3. Publish:

   ```bash
   npx vsce login YOUR-PUBLISHER-ID
   npx vsce publish
   ```
