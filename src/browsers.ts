/**
 * The browsers the user can pick from, per operating system.
 * @packageDocumentation
 */
import * as vscode from 'vscode';

/** Map of browser name (e.g. `chrome`) to the absolute path of its executable. */
export interface BrowserMap {
  [name: string]: string;
}

/**
 * Usual install locations of the supported browsers on macOS and Linux, keyed by `process.platform`.
 *
 * The built-in defaults in `package.json` are the Windows install locations. On macOS and Linux those
 * paths don't exist, so these are used instead (the user's own entries are added on top).
 * Windows has no entry here on purpose: it relies on the `package.json` defaults.
 */
const PLATFORM_DEFAULTS: { [platform: string]: BrowserMap } = {
  darwin: {
    chrome: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    edge: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    firefox: '/Applications/Firefox.app/Contents/MacOS/firefox',
    chromium: '/Applications/Chromium.app/Contents/MacOS/Chromium'
  },
  linux: {
    chrome: '/usr/bin/google-chrome',
    edge: '/usr/bin/microsoft-edge',
    firefox: '/usr/bin/firefox',
    chromium: '/usr/bin/chromium'
  }
};

/**
 * Returns the browsers the user can choose from.
 *
 * - Windows: the `cfBrowserLauncher.browsers` setting, which VS Code already merges with the defaults
 *   declared in `package.json`.
 * - macOS and Linux: the platform defaults, plus the entries the user configured (global, workspace
 *   or workspace folder), which win over the defaults when they use the same name.
 *
 * @returns A map of browser name to executable path.
 */
export function getBrowsers(): BrowserMap {
  const config = vscode.workspace.getConfiguration('cfBrowserLauncher');
  const defaults = PLATFORM_DEFAULTS[process.platform];
  if (!defaults) {
    // Windows: package.json defaults merged with the user's settings, as VS Code does.
    return config.get<BrowserMap>('browsers', {});
  }

  const configured = config.inspect<BrowserMap>('browsers');
  return {
    ...defaults,
    ...configured?.globalValue,
    ...configured?.workspaceValue,
    ...configured?.workspaceFolderValue
  };
}