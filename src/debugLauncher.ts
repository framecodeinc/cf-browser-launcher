import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { AdobeProject, findProject, isUsableProject } from './projectResolver';

const ADOBE_EXTENSION_ID = 'com-adobe-coldfusion.adobe-cfml-lsp';
const ADOBE_DEBUG_TYPE = 'cfml-debugger';
export const BROWSER_DEBUG_TYPE = 'cfbl-cfml-debugger';

const STATUS_POLL_MS = 400;
const NOT_INTERCEPTED_TIMEOUT_MS = 30000;

interface BrowserMap {
  [name: string]: string;
}

interface BrowserChoice {
  key: string;
  path: string;
}

interface StatusEntry {
  status: 'ok' | 'error';
  message: string;
}

// Set when the extension activates: the folder that holds every extension's global storage.
let globalStorageRoot = '';
let state: vscode.Memento | undefined;
let channel: vscode.OutputChannel | undefined;

// Short, human-readable log of what the debug launcher does (one line per event; no protocol traffic).
function log(line: string): void {
  if (!channel) {
    channel = vscode.window.createOutputChannel('ColdFusion Browser Launcher');
  }
  const time = new Date().toLocaleTimeString();
  channel.appendLine(`[${time}] ${line}`);
}

function showLog(): void {
  if (!channel) {
    log('Nothing recorded yet.');
  }
  channel?.show(true);
}

// Errors are also logged and offer a shortcut to the log.
function showError(message: string): void {
  log(`ERROR: ${message}`);
  void vscode.window.showErrorMessage(message, 'Show Log').then((choice) => {
    if (choice === 'Show Log') {
      showLog();
    }
  });
}

const REMEMBERED_KEY = 'cfbl.rememberedProjects';
const MAX_REMEMBERED = 50;

function getRemembered(): AdobeProject[] {
  return state?.get<AdobeProject[]>(REMEMBERED_KEY, []) ?? [];
}

// Adobe's session configuration carries the project either as an object or as a JSON string.
function parseProject(value: unknown): AdobeProject | undefined {
  let candidate: unknown = value;
  if (typeof value === 'string') {
    try {
      candidate = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  return isUsableProject(candidate) ? candidate : undefined;
}

// Remembers the project of a debug session so the next one can skip Adobe's "select project" prompt.
function remember(project: AdobeProject): void {
  const all = getRemembered();
  const index = all.findIndex((p) => p.id === project.id);
  if (index >= 0 && JSON.stringify(all[index]) === JSON.stringify(project)) {
    return;
  }
  if (index >= 0) {
    all[index] = project;
  } else {
    all.unshift(project);
  }
  void state?.update(REMEMBERED_KEY, all.slice(0, MAX_REMEMBERED));
  log(`Remembered project '${project.label}' for next time.`);
}

// Adobe keeps its projects and servers in <globalStorage>/<extension id>/adobe-cfml.json.
function getAdobeGlobalConfigPath(): string | undefined {
  if (!globalStorageRoot) {
    return undefined;
  }
  const file = path.join(globalStorageRoot, ADOBE_EXTENSION_ID, 'adobe-cfml.json');
  return fs.existsSync(file) ? file : undefined;
}

function capitalize(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function resolveTarget(uri?: vscode.Uri): vscode.Uri | undefined {
  const target = uri ?? vscode.window.activeTextEditor?.document.uri;
  return target && target.scheme === 'file' ? target : undefined;
}

function getAdobeAdapterPath(): string | undefined {
  const adobe = vscode.extensions.getExtension(ADOBE_EXTENSION_ID);
  if (!adobe) {
    return undefined;
  }
  const adapterPath = path.join(adobe.extensionPath, 'out', 'debugger', 'adapter.js');
  return fs.existsSync(adapterPath) ? adapterPath : undefined;
}

class BrowserDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
  constructor(private readonly wrapperPath: string) {}

  createDebugAdapterDescriptor(session: vscode.DebugSession): vscode.DebugAdapterDescriptor {
    const adapterPath = getAdobeAdapterPath();
    if (!adapterPath) {
      throw new Error(
        "Adobe's debug adapter was not found. Is the Adobe ColdFusion Builder extension installed and up to date?"
      );
    }

    const browserPath = String(session.configuration.cfblBrowserPath ?? '');
    if (!browserPath || !fs.existsSync(browserPath)) {
      throw new Error(`Browser executable not found: '${browserPath}'.`);
    }

    // The extension host runs on Electron; with ELECTRON_RUN_AS_NODE the same binary behaves as plain Node.
    return new vscode.DebugAdapterExecutable(process.execPath, [this.wrapperPath, adapterPath], {
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        CFBL_BROWSER_PATH: browserPath,
        CFBL_STATUS_FILE: String(session.configuration.cfblStatusFile ?? '')
      }
    });
  }
}

function readStatus(statusFile: string): StatusEntry | undefined {
  let content: string;
  try {
    content = fs.readFileSync(statusFile, 'utf8');
  } catch {
    return undefined;
  }

  let ok: StatusEntry | undefined;
  for (const line of content.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    try {
      const entry = JSON.parse(line) as StatusEntry;
      if (entry.status === 'error') {
        return entry;
      }
      if (entry.status === 'ok') {
        ok = entry;
      }
    } catch {
      // Partially written line: it will be complete on the next poll.
    }
  }
  return ok;
}

// Waits for the adapter wrapper to report what happened with the browser and tells the user.
// If nothing is reported in time, the launch was not intercepted: say so instead of failing silently.
function watchBrowserLaunch(statusFile: string, fileName: string, browser: BrowserChoice): void {
  const startedAt = Date.now();
  let sessionEnded = false;
  let finished = false;
  let timer: NodeJS.Timeout | undefined;

  const endListener = vscode.debug.onDidTerminateDebugSession((session) => {
    if (session.configuration.cfblStatusFile === statusFile) {
      sessionEnded = true;
    }
  });

  const finish = (): void => {
    if (finished) {
      return;
    }
    finished = true;
    if (timer) {
      clearInterval(timer);
    }
    endListener.dispose();
    try {
      fs.rmSync(statusFile, { force: true });
    } catch {
      // Leftover temp file: harmless.
    }
  };

  timer = setInterval(() => {
    const ended = sessionEnded;
    const status = readStatus(statusFile);

    if (status) {
      finish();
      if (status.status === 'ok') {
        log(status.message);
        void vscode.window.showInformationMessage(
          `Debugging '${fileName}' in ${capitalize(browser.key)}...`
        );
      } else {
        showError(`Debug: ${status.message}`);
      }
      return;
    }

    if (ended) {
      // The session ended before opening a browser (e.g. breakpoint error): Adobe already reported why.
      finish();
      return;
    }

    if (Date.now() - startedAt > NOT_INTERCEPTED_TIMEOUT_MS) {
      finish();
      showError(
        `Debug: the browser launch could not be redirected to ${capitalize(browser.key)}. ` +
          "Adobe's debugger may have changed; the system default browser may have opened instead."
      );
    }
  }, STATUS_POLL_MS);
}

async function startDebug(target: vscode.Uri, browser?: BrowserChoice): Promise<void> {
  const fileName = path.basename(target.fsPath);

  const adobe = vscode.extensions.getExtension(ADOBE_EXTENSION_ID);
  if (!adobe) {
    showError(
      'The Adobe ColdFusion Builder extension is required to debug .cfm files and is not installed.'
    );
    return;
  }

  if (browser && !fs.existsSync(browser.path)) {
    showError(
      `Browser executable for '${browser.key}' not found: ${browser.path}. Check cfBrowserLauncher.browsers.`
    );
    return;
  }

  if (browser && !getAdobeAdapterPath()) {
    showError(
      "Adobe's debug adapter was not found inside the ColdFusion Builder extension. " +
        'This feature needs a compatible version of that extension.'
    );
    return;
  }

  try {
    // Adobe's commands used below are registered when its extension is active.
    await adobe.activate();
  } catch (err) {
    showError(
      `Could not activate the Adobe ColdFusion Builder extension: ${(err as Error).message}`
    );
    return;
  }

  // Work out the project from the file, so Adobe's "select project" prompt is not needed.
  // If that is not possible, fall back to Adobe's own lookup (which asks once; the answer is remembered).
  const adobeConfigPath = getAdobeGlobalConfigPath();
  let globalConfigFilePath: string =
    adobeConfigPath ?? '${command:cfml.debugger.getGlobalConfigFilePath}';
  let project: unknown = '${command:cfml.debugger.getProjectForDebugger}';

  const workspaceRoots = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  const found = findProject(adobeConfigPath, target.fsPath, getRemembered(), workspaceRoots);
  if (found) {
    project = found;
    log(`Project: '${found.label}'.`);
  } else {
    log('Project: not found automatically; Adobe will ask.');
  }

  if (typeof project === 'string') {
    // Adobe's project lookup follows the active editor, so make sure it is the file to debug.
    await vscode.window.showTextDocument(target, { preview: true });
  }

  const statusFile = browser
    ? path.join(os.tmpdir(), `cfbl-debug-${process.pid}-${Date.now()}.status`)
    : '';

  const config: vscode.DebugConfiguration = {
    type: browser ? BROWSER_DEBUG_TYPE : ADOBE_DEBUG_TYPE,
    request: 'launch',
    name: browser ? `CFML Debug (${capitalize(browser.key)})` : 'CFML Debug',
    program: target.fsPath,
    globalConfigFilePath,
    project,
    stopOnEntry: false
  };

  if (browser) {
    config.cfblBrowserPath = browser.path;
    config.cfblStatusFile = statusFile;
    watchBrowserLaunch(statusFile, fileName, browser);
  }

  const folder = vscode.workspace.getWorkspaceFolder(target);
  log(
    `Debug '${fileName}' in ${browser ? capitalize(browser.key) : 'the system default browser'}.`
  );
  const started = await vscode.debug.startDebugging(folder, config);
  if (!started) {
    showError(
      `The debug session for '${fileName}' could not be started. ` +
        "See the 'Adobe ColdFusion' output channel for details."
    );
  }
}

export function registerDebugLauncher(context: vscode.ExtensionContext): void {
  globalStorageRoot = path.dirname(context.globalStorageUri.fsPath);
  state = context.globalState;
  const wrapperPath = context.asAbsolutePath(path.join('out', 'adapterWrapper.js'));

  context.subscriptions.push(
    vscode.debug.onDidStartDebugSession((session) => {
      if (session.type !== ADOBE_DEBUG_TYPE && session.type !== BROWSER_DEBUG_TYPE) {
        return;
      }
      log(`Session started: ${session.name}`);
      const project = parseProject(session.configuration.project);
      if (project) {
        remember(project);
      }
    }),

    vscode.debug.onDidTerminateDebugSession((session) => {
      if (session.type === ADOBE_DEBUG_TYPE || session.type === BROWSER_DEBUG_TYPE) {
        log(`Session ended: ${session.name}`);
      }
    }),

    vscode.commands.registerCommand('cfBrowserLauncher.showLog', showLog),

    { dispose: () => channel?.dispose() },

    vscode.commands.registerCommand('cfBrowserLauncher.forgetProjects', async () => {
      await state?.update(REMEMBERED_KEY, undefined);
      void vscode.window.showInformationMessage(
        'Remembered ColdFusion projects cleared. Adobe will ask for the project again on the next debug.'
      );
    }),

    vscode.debug.registerDebugAdapterDescriptorFactory(
      BROWSER_DEBUG_TYPE,
      new BrowserDebugAdapterFactory(wrapperPath)
    ),

    vscode.commands.registerCommand(
      'cfBrowserLauncher.debugInDefault',
      async (uri?: vscode.Uri) => {
        const target = resolveTarget(uri);
        if (!target) {
          void vscode.window.showWarningMessage('No .cfm file selected.');
          return;
        }

        const config = vscode.workspace.getConfiguration('cfBrowserLauncher');
        const browsers = config.get<BrowserMap>('browsers', {});
        const key = config.get<string>('defaultBrowser', '');

        if (!key) {
          // Same rule as 'Run CFM File in Default Browser': no key means the system default browser,
          // which is what Adobe's debugger does on its own.
          await startDebug(target);
          return;
        }

        const browserPath = browsers[key];
        if (!browserPath) {
          showError(`No path configured for browser '${key}' in cfBrowserLauncher.browsers.`);
          return;
        }

        await startDebug(target, { key, path: browserPath });
      }
    ),

    vscode.commands.registerCommand(
      'cfBrowserLauncher.debugChooseBrowser',
      async (uri?: vscode.Uri) => {
        const target = resolveTarget(uri);
        if (!target) {
          void vscode.window.showWarningMessage('No .cfm file selected.');
          return;
        }

        const browsers = vscode.workspace
          .getConfiguration('cfBrowserLauncher')
          .get<BrowserMap>('browsers', {});
        const items = Object.keys(browsers).map((key) => ({ label: capitalize(key), key }));

        const pick = await vscode.window.showQuickPick(items, {
          placeHolder: `Choose browser to debug '${path.basename(target.fsPath)}'`
        });
        if (!pick) {
          return;
        }

        await startDebug(target, { key: pick.key, path: browsers[pick.key] });
      }
    )
  );
}
