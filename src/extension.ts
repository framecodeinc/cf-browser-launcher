import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';

interface BrowserMap {
  [name: string]: string;
}

function capitalize(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

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

  const relative = path
    .relative(documentRoot, fileUri.fsPath)
    .split(path.sep)
    .join('/');

  return `${serverHost.replace(/\/$/, '')}/${projectName}/${relative}`;
}

function launchBrowser(browserKey: string, browserPath: string, url: string, fileName: string): void {
  execFile(browserPath, [url], (err) => {
    if (err) {
      vscode.window.showErrorMessage(
        `Could not open the browser (${browserPath}): ${err.message}`
      );
      return;
    }

    vscode.window.showInformationMessage(`Running '${fileName}' in ${capitalize(browserKey)}...`);
  });
}

function launchInSystemDefaultBrowser(url: string, fileName: string): void {
  const platform = os.platform();
  let command: string;
  let args: string[];

  if (platform === 'win32') {
    // The empty "" is required: it's consumed by `start` as the window title,
    // so the URL isn't mistaken for one.
    command = 'cmd';
    args = ['/c', 'start', '""', url];
  } else if (platform === 'darwin') {
    command = 'open';
    args = [url];
  } else {
    command = 'xdg-open';
    args = [url];
  }

  execFile(command, args, (err) => {
    if (err) {
      vscode.window.showErrorMessage(
        `Could not open the system default browser for '${fileName}': ${err.message}`
      );
      return;
    }

    vscode.window.showInformationMessage(`Running '${fileName}' in the system default browser...`);
  });
}

interface BrowserQuickPickItem extends vscode.QuickPickItem {
  key: string;
}

function resolveTargetUri(uri?: vscode.Uri): vscode.Uri | undefined {
  return uri ?? vscode.window.activeTextEditor?.document.uri;
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'cfBrowserLauncher.openInDefault',
      (uri?: vscode.Uri) => {
        const target = resolveTargetUri(uri);
        if (!target) {
          vscode.window.showWarningMessage('No .cfm file selected.');
          return;
        }

        const config = vscode.workspace.getConfiguration('cfBrowserLauncher');
        const browsers = config.get<BrowserMap>('browsers', {});
        const key = config.get<string>('defaultBrowser', '');
        const fileName = path.basename(target.fsPath);

        if (!key) {
          launchInSystemDefaultBrowser(buildUrl(target), fileName);
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
      }
    ),

    vscode.commands.registerCommand(
      'cfBrowserLauncher.chooseBrowser',
      async (uri?: vscode.Uri) => {
        const target = resolveTargetUri(uri);
        if (!target) {
          vscode.window.showWarningMessage('No .cfm file selected.');
          return;
        }

        const fileName = path.basename(target.fsPath);
        const config = vscode.workspace.getConfiguration('cfBrowserLauncher');
        const browsers = config.get<BrowserMap>('browsers', {});
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
      }
    )
  );
}

export function deactivate(): void {}