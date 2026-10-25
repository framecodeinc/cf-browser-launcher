/**
 * ColdFusion Browser Launcher: runs ColdFusion files in the browser of your choice.
 *
 * This file has the "Run ColdFusion File in..." commands; debugging lives in `debugLauncher.ts`.
 *
 * @packageDocumentation
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';
import { BrowserMap, getBrowsers } from './browsers';
import { registerDebugLauncher } from './debugLauncher';
import { encodePath } from './urlUtils';

/** @returns The name with its first letter in upper case (`chrome` becomes `Chrome`). */
function capitalize(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Builds the URL of a file on the local ColdFusion server.
 *
 * The result is `serverHost/projectName/relativePath`. When `documentRoot` is not set, the workspace
 * folder containing the file is used; when `projectName` is not set, the document root's folder name
 * is used. The project name and the path are URL-encoded.
 *
 * @param fileUri - The file to open.
 * @returns The URL to open in a browser.
 */
function buildUrl(fileUri: vscode.Uri): string {
  const config = vscode.workspace.getConfiguration('cfBrowserLauncher');
  const serverHost = config.get<string>('serverHost', '');
  let documentRoot = config.get<string>('documentRoot', '');
  let projectName = config.get<string>('projectName', '');

  if (!documentRoot) {
    const folder = vscode.workspace.getWorkspaceFolder(fileUri);
    documentRoot = folder ? folder.uri.fsPath : path.dirname(fileUri.fsPath);
  }

  if (!projectName) {
    projectName = path.basename(documentRoot);
  }

  const relative = path.relative(documentRoot, fileUri.fsPath).split(path.sep).join('/');

  return `${serverHost.replace(/\/$/, '')}/${encodePath(projectName)}/${encodePath(relative)}`;
}

/**
 * Opens a URL in a specific browser and tells the user what happened.
 *
 * @param browserKey - Name of the browser, for the message.
 * @param browserPath - Absolute path of the browser executable.
 * @param url - The page to open.
 * @param fileName - Name of the file being run, for the message.
 */
function launchBrowser(
  browserKey: string,
  browserPath: string,
  url: string,
  fileName: string
): void {
  execFile(browserPath, [url], (err) => {
    if (err) {
      vscode.window.showErrorMessage(`Could not open the browser (${browserPath}): ${err.message}`);
      return;
    }

    vscode.window.showInformationMessage(`Running '${fileName}' in ${capitalize(browserKey)}...`);
  });
}

/**
 * Opens a URL in the operating system's default browser, through VS Code, and tells the user what
 * happened. It works the same on every platform and, in a remote window, opens on the machine VS Code
 * is shown on.
 *
 * @param url - The page to open; it must start with `http://` or `https://`.
 * @param fileName - Name of the file being run, for the message.
 */
async function launchInSystemDefaultBrowser(url: string, fileName: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) {
    vscode.window.showErrorMessage(
      "cfBrowserLauncher.serverHost must start with 'http://' or 'https://'."
    );
    return;
  }

  // Let VS Code open the link with the operating system's default browser (works on every platform
  // and, in remote windows, on the machine VS Code is shown on).
  let opened = false;
  try {
    opened = await vscode.env.openExternal(vscode.Uri.parse(url, true));
  } catch (err) {
    vscode.window.showErrorMessage(
      `Could not open the system default browser for '${fileName}': ${(err as Error).message}`
    );
    return;
  }

  if (!opened) {
    vscode.window.showErrorMessage(`Could not open the system default browser for '${fileName}'.`);
    return;
  }

  vscode.window.showInformationMessage(`Running '${fileName}' in the system default browser...`);
}

/** An entry of the browser picker. */
interface BrowserQuickPickItem extends vscode.QuickPickItem {
  key: string;
}

/**
 * @param uri - The file the command was invoked on (Explorer or editor menu), if any.
 * @returns That file, or the active editor's file when the command came from the Command Palette.
 */
function resolveTargetUri(uri?: vscode.Uri): vscode.Uri | undefined {
  return uri ?? vscode.window.activeTextEditor?.document.uri;
}

/**
 * Called by VS Code when the extension is activated. Registers the run commands and the debug ones.
 *
 * @param context - The extension context, used to register everything for disposal.
 */
export function activate(context: vscode.ExtensionContext): void {
  registerDebugLauncher(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('cfBrowserLauncher.openInDefault', (uri?: vscode.Uri) => {
      const target = resolveTargetUri(uri);
      if (!target) {
        vscode.window.showWarningMessage('No .cfm or .cfc file selected.');
        return;
      }

      const config = vscode.workspace.getConfiguration('cfBrowserLauncher');
      const browsers = getBrowsers();
      const key = config.get<string>('defaultBrowser', '');
      const fileName = path.basename(target.fsPath);

      if (!key) {
        void launchInSystemDefaultBrowser(buildUrl(target), fileName);
        return;
      }

      const browserPath = browsers[key];

      if (!browserPath) {
        vscode.window.showErrorMessage(
          `No path configured for browser '${key}' in cfBrowserLauncher.browsers.`
        );
        return;
      }

      launchBrowser(key, browserPath, buildUrl(target), fileName);
    }),

    vscode.commands.registerCommand('cfBrowserLauncher.chooseBrowser', async (uri?: vscode.Uri) => {
      const target = resolveTargetUri(uri);
      if (!target) {
        vscode.window.showWarningMessage('No .cfm or .cfc file selected.');
        return;
      }

      const fileName = path.basename(target.fsPath);
      const browsers: BrowserMap = getBrowsers();
      const items: BrowserQuickPickItem[] = Object.keys(browsers).map((key) => ({
        label: capitalize(key),
        key
      }));

      const pick = await vscode.window.showQuickPick(items, {
        placeHolder: `Choose browser to run '${fileName}'`
      });

      if (!pick) {
        return;
      }

      launchBrowser(pick.key, browsers[pick.key], buildUrl(target), fileName);
    })
  );
}

/** Called by VS Code when the extension is deactivated. Nothing to clean up. */
export function deactivate(): void {}