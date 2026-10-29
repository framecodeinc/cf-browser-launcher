/**
 * "Debug ColdFusion File in..." support: starts Adobe's debugger for a file and opens the page in the
 * browser the user chose.
 *
 * Adobe's debugger always opens the operating system's default browser. For another browser, a
 * debug session of this extension's own type ({@link BROWSER_DEBUG_TYPE}) runs Adobe's adapter
 * through `adapterWrapper.ts`, which redirects that one step. This module also finds the ColdFusion
 * project of the file (so Adobe's "select project" prompt isn't needed), remembers projects, keeps a
 * short log and reports problems to the user.
 *
 * @packageDocumentation
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { getBrowsers } from './browsers';
import { AdobeProject, findProject, isUsableProject } from './projectResolver';

/** Identifier of Adobe's ColdFusion Builder extension (`publisher.name`). */
const ADOBE_EXTENSION_ID = 'com-adobe-coldfusion.adobe-cfml-lsp';

/** Debug type of Adobe's own debugger. Used when the system default browser is wanted. */
const ADOBE_DEBUG_TYPE = 'cfml-debugger';

/** Debug type contributed by this extension; it runs Adobe's adapter through the wrapper. */
export const BROWSER_DEBUG_TYPE = 'cfbl-cfml-debugger';

/**
 * The version of the Adobe ColdFusion Builder extension this feature was built and tested against.
 * Other versions may work, but Adobe could change how its debugger opens the browser.
 */
const TESTED_ADOBE_VERSION = '1.0.880';

/** How often (ms) the wrapper's status file is checked. */
const STATUS_POLL_MS = 400;

/** How long (ms) to wait for the wrapper to report before telling the user the redirect failed. */
const NOT_INTERCEPTED_TIMEOUT_MS = 30000;

/** A browser picked by the user. */
interface BrowserChoice {
  /** Name of the entry in `cfBrowserLauncher.browsers`, e.g. `chrome`. */
  key: string;
  /** Absolute path of the browser executable. */
  path: string;
}

/** One line of the status file written by the adapter wrapper. */
interface StatusEntry {
  /** `ok` when the chosen browser was started, `error` otherwise. */
  status: 'ok' | 'error';
  /** Human-readable detail. */
  message: string;
}

/** Folder that holds the global storage of every extension (the parent of this extension's own). */
let globalStorageRoot = '';

/** Storage that survives restarts; used to remember projects. Set on activation. */
let state: vscode.Memento | undefined;

/** Output panel with the short log. Created the first time something is logged. */
let channel: vscode.OutputChannel | undefined;

/**
 * Adds a line, with the time, to the "ColdFusion Browser Launcher" output panel.
 *
 * One line per event; no protocol traffic.
 *
 * @param line - The text to record.
 */
function log(line: string): void {
  if (!channel) {
    channel = vscode.window.createOutputChannel('ColdFusion Browser Launcher');
  }
  const time = new Date().toLocaleTimeString();
  channel.appendLine(`[${time}] ${line}`);
}

/** Shows the output panel with the log, without taking focus from the editor. */
function showLog(): void {
  if (!channel) {
    log('Nothing recorded yet.');
  }
  channel?.show(true);
}

/**
 * Shows an error message and also records it in the log.
 *
 * The message has a **Show Log** button that opens the log.
 *
 * @param message - What went wrong, in terms the user can act on.
 */
function showError(message: string): void {
  log(`ERROR: ${message}`);
  void vscode.window.showErrorMessage(message, 'Show Log').then((choice) => {
    if (choice === 'Show Log') {
      showLog();
    }
  });
}

/** Key under which the remembered projects are stored. */
const REMEMBERED_KEY = 'cfbl.rememberedProjects';

/** Maximum number of remembered projects; the oldest are dropped first. */
const MAX_REMEMBERED = 50;

/** @returns The projects remembered from earlier debug sessions (empty when there are none). */
function getRemembered(): AdobeProject[] {
  return state?.get<AdobeProject[]>(REMEMBERED_KEY, []) ?? [];
}

/**
 * Reads a project out of a debug session configuration.
 *
 * Adobe's configuration carries the project either as an object or as a JSON string.
 *
 * @param value - The `project` attribute of the configuration.
 * @returns The project, or `undefined` if it is missing or not usable.
 */
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

/**
 * Remembers the project of a debug session so the next one can skip Adobe's "select project" prompt.
 *
 * Does nothing if the same project data is already stored.
 *
 * @param project - The project to store (replaces an older copy with the same id).
 */
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

/**
 * Adobe keeps its servers (and, depending on its version, projects) in
 * `<globalStorage>/<extension id>/adobe-cfml.json`.
 *
 * @returns The path of that file, or `undefined` if it doesn't exist.
 */
function getAdobeGlobalConfigPath(): string | undefined {
  if (!globalStorageRoot) {
    return undefined;
  }
  const file = path.join(globalStorageRoot, ADOBE_EXTENSION_ID, 'adobe-cfml.json');
  return fs.existsSync(file) ? file : undefined;
}

/** @returns The name with its first letter in upper case (`chrome` becomes `Chrome`). */
function capitalize(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Works out which file a command applies to.
 *
 * @param uri - The file the command was invoked on (Explorer or editor menu), if any.
 * @returns That file, or the active editor's file; `undefined` if neither is a file on disk.
 */
function resolveTarget(uri?: vscode.Uri): vscode.Uri | undefined {
  const target = uri ?? vscode.window.activeTextEditor?.document.uri;
  return target && target.scheme === 'file' ? target : undefined;
}

/** @returns The installed version of Adobe's ColdFusion Builder extension, or `unknown`. */
function getAdobeVersion(): string {
  const version: unknown = vscode.extensions.getExtension(ADOBE_EXTENSION_ID)?.packageJSON?.version;
  return typeof version === 'string' ? version : 'unknown';
}

/** @returns The path of Adobe's `adapter.js` inside its extension, or `undefined` if it isn't there. */
function getAdobeAdapterPath(): string | undefined {
  const adobe = vscode.extensions.getExtension(ADOBE_EXTENSION_ID);
  if (!adobe) {
    return undefined;
  }
  const adapterPath = path.join(adobe.extensionPath, 'out', 'debugger', 'adapter.js');
  return fs.existsSync(adapterPath) ? adapterPath : undefined;
}

/**
 * Tells VS Code how to start the debug adapter of {@link BROWSER_DEBUG_TYPE}: Adobe's own adapter,
 * launched through the wrapper that redirects the browser (or, with `cfblSystemDefault`, that only
 * stops the adapter from waiting for the system default browser to close).
 */
class BrowserDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
  /** @param wrapperPath - Absolute path of this extension's `adapterWrapper.js`. */
  constructor(private readonly wrapperPath: string) {}

  /**
   * @param session - The session being started; its configuration has `cfblBrowserPath` (browser to
   *   use) or `cfblSystemDefault` (use the system default browser), and `cfblStatusFile` (where the
   *   wrapper reports the outcome).
   * @returns The command that starts the wrapper (VS Code's own binary, running as plain Node).
   * @throws If Adobe's adapter or the chosen browser can't be found.
   */
  createDebugAdapterDescriptor(session: vscode.DebugSession): vscode.DebugAdapterDescriptor {
    const adapterPath = getAdobeAdapterPath();
    if (!adapterPath) {
      throw new Error(
        "Adobe's debug adapter was not found. Is the Adobe ColdFusion Builder extension installed and up to date?"
      );
    }

    const systemDefault = session.configuration.cfblSystemDefault === true;
    const browserPath = systemDefault ? '' : String(session.configuration.cfblBrowserPath ?? '');
    if (!systemDefault && (!browserPath || !fs.existsSync(browserPath))) {
      throw new Error(`Browser executable not found: '${browserPath}'.`);
    }

    // The extension host runs on Electron; with ELECTRON_RUN_AS_NODE the same binary behaves as plain Node.
    return new vscode.DebugAdapterExecutable(process.execPath, [this.wrapperPath, adapterPath], {
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        CFBL_BROWSER_PATH: browserPath,
        CFBL_NO_WAIT: systemDefault ? '1' : '',
        CFBL_STATUS_FILE: String(session.configuration.cfblStatusFile ?? '')
      }
    });
  }
}

/**
 * Reads what the adapter wrapper reported.
 *
 * @param statusFile - Path of the status file.
 * @returns The first error if there is one, otherwise the last `ok`; `undefined` if nothing was reported yet.
 */
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

/**
 * Waits for the adapter wrapper to report what happened with the browser and tells the user.
 *
 * If nothing is reported in time, the launch was not intercepted: it says so instead of failing
 * silently. If the session ends first, nothing is added, because Adobe already reported why.
 *
 * @param statusFile - Status file the wrapper writes to (removed when done).
 * @param fileName - Name of the file being debugged, for the messages.
 * @param browser - The browser the user picked; omit for the system default browser.
 */
function watchBrowserLaunch(statusFile: string, fileName: string, browser?: BrowserChoice): void {
  const label = browser ? capitalize(browser.key) : 'the system default browser';
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
        void vscode.window.showInformationMessage(`Debugging '${fileName}' in ${label}...`);
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
        `Debug: the browser launch could not be ${browser ? `redirected to ${label}` : 'adjusted'}. ` +
          "Adobe's debugger may have changed; the system default browser may have opened instead. " +
          `(Adobe ColdFusion Builder extension ${getAdobeVersion()}; tested with ${TESTED_ADOBE_VERSION}.)`
      );
    }
  }, STATUS_POLL_MS);
}

/**
 * Starts a debug session for a file.
 *
 * Finds the file's project so Adobe doesn't ask for it (falling back to Adobe's own prompt), then
 * starts Adobe's debugger directly (system default browser) or this extension's type (chosen browser).
 *
 * @param target - The `.cfm` or `.cfc` file to debug.
 * @param browser - The browser to open the page in; omit to use the operating system's default.
 */
async function startDebug(target: vscode.Uri, browser?: BrowserChoice): Promise<void> {
  const fileName = path.basename(target.fsPath);

  // Adobe's adapter on Linux waits for the browser to close before it listens for breakpoints, so
  // there the system default browser also goes through the wrapper (which stops that wait).
  const useWrapper = !!browser || process.platform === 'linux';

  const adobe = vscode.extensions.getExtension(ADOBE_EXTENSION_ID);
  if (!adobe) {
    showError(
      'The Adobe ColdFusion Builder extension is required to debug ColdFusion files and is not installed.'
    );
    return;
  }

  if (browser && !fs.existsSync(browser.path)) {
    showError(
      `Browser executable for '${browser.key}' not found: ${browser.path}. Check cfBrowserLauncher.browsers.`
    );
    return;
  }

  if (useWrapper && !getAdobeAdapterPath()) {
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

  const statusFile = useWrapper
    ? path.join(os.tmpdir(), `cfbl-debug-${process.pid}-${Date.now()}.status`)
    : '';

  const config: vscode.DebugConfiguration = {
    type: useWrapper ? BROWSER_DEBUG_TYPE : ADOBE_DEBUG_TYPE,
    request: 'launch',
    name: browser ? `CFML Debug (${capitalize(browser.key)})` : 'CFML Debug',
    program: target.fsPath,
    globalConfigFilePath,
    project,
    stopOnEntry: false
  };

  if (useWrapper) {
    if (browser) {
      config.cfblBrowserPath = browser.path;
    } else {
      config.cfblSystemDefault = true;
    }
    config.cfblStatusFile = statusFile;
    watchBrowserLaunch(statusFile, fileName, browser);
  }

  const folder = vscode.workspace.getWorkspaceFolder(target);
  if (useWrapper) {
    log(
      `Adobe ColdFusion Builder extension ${getAdobeVersion()} (tested with ${TESTED_ADOBE_VERSION}).`
    );
  }
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

/**
 * Registers the debug type, its adapter factory and the debug-related commands.
 *
 * Commands: `debugInDefault`, `debugChooseBrowser`, `showLog` and `forgetProjects`. Also remembers the
 * project of every debug session that starts.
 *
 * @param context - The extension context, used for storage and subscriptions.
 */
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
          void vscode.window.showWarningMessage('No .cfm or .cfc file selected.');
          return;
        }

        const config = vscode.workspace.getConfiguration('cfBrowserLauncher');
        const browsers = getBrowsers();
        const key = config.get<string>('defaultBrowser', '');

        if (!key) {
          // Same rule as 'Run ColdFusion File in Default Browser': no key means the system default browser,
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
          void vscode.window.showWarningMessage('No .cfm or .cfc file selected.');
          return;
        }

        const browsers = getBrowsers();
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