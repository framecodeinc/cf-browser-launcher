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
 * Usual install locations of the supported browsers, keyed by `process.platform`.
 *
 * They are provided here, and not as the default of the setting in `package.json`, because VS Code
 * can't have a different default per operating system (the Settings screen would show the paths of
 * one system on all of them).
 */
const PLATFORM_DEFAULTS: { [platform: string]: BrowserMap } = {
  win32: {
    chrome: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    edge: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    firefox: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
    chromium: 'C:\\Program Files\\Chromium\\Application\\chrome.exe'
  },
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
 * Returns the browsers the user can choose from: the ones built in for this operating system, plus the
 * entries of `cfBrowserLauncher.browsers` (user, workspace or workspace folder). An entry with the
 * same name as a built-in one replaces it, which is how a path is changed.
 *
 * It is read every time, so changes to the setting apply without reloading anything.
 *
 * @returns A map of browser name to executable path.
 */
export function getBrowsers(): BrowserMap {
  const configured = vscode.workspace
    .getConfiguration('cfBrowserLauncher')
    .inspect<BrowserMap>('browsers');

  return {
    ...PLATFORM_DEFAULTS[process.platform],
    ...configured?.globalValue,
    ...configured?.workspaceValue,
    ...configured?.workspaceFolderValue
  };
}