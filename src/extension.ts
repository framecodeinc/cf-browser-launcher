import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';

interface BrowserMap {
  [name: string]: string;
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

function launchBrowser(browserPath: string, url: string): void {
  execFile(browserPath, [url], (err) => {
    if (err) {
      vscode.window.showErrorMessage(
        `Could not open the browser (${browserPath}): ${err.message}`
      );
    }
  });
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
        const browserPath = browsers[key];

        if (!browserPath) {
          vscode.window.showErrorMessage(
            `No path configured for browser '${key}' in cfBrowserLauncher.browsers.`
          );
          return;
        }

        launchBrowser(browserPath, buildUrl(target));
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

        const config = vscode.workspace.getConfiguration('cfBrowserLauncher');
        const browsers = config.get<BrowserMap>('browsers', {});
        const pick = await vscode.window.showQuickPick(Object.keys(browsers), {
          placeHolder: 'Choose the browser to open this file'
        });

        if (!pick) {
          return;
        }

        launchBrowser(browsers[pick], buildUrl(target));
      }
    )
  );
}

export function deactivate(): void {}