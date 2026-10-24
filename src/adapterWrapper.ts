/*
 * Runs inside the debug adapter process (NOT in the extension host).
 * IMPORTANT: never write to stdout here, it carries the Debug Adapter Protocol traffic.
 *
 * It patches child_process.spawn in memory so that, when Adobe's adapter asks the OS to open
 * the debug URL, the browser chosen by the user is used instead. Adobe's files are not modified.
 * Then it loads Adobe's adapter, which starts exactly as if VS Code had launched it directly.
 */
import { EventEmitter } from 'events';
import * as fs from 'fs';

// require() on purpose: an `import * as` namespace may be a copy, and we must patch the real module object.
const childProcess: typeof import('child_process') = require('child_process');

const adapterPath = process.argv[2];
const browserPath = process.env.CFBL_BROWSER_PATH ?? '';
const statusFile = process.env.CFBL_STATUS_FILE ?? '';
const URL_PATTERN = /https?:\/\/[^\s"'`]+/i;

function report(status: 'ok' | 'error', message: string): void {
  if (!statusFile) {
    return;
  }
  try {
    fs.appendFileSync(statusFile, `${JSON.stringify({ status, message })}\n`);
  } catch {
    // Nothing else we can do from here.
  }
}

// Finds the URL in the arguments of the spawn call. Adobe's adapter uses the `open` package, which on
// Windows runs: powershell ... -EncodedCommand <base64 (UTF-16LE) of: Start -Wait "http://...">
function findUrl(args: readonly string[]): string | undefined {
  for (const arg of args) {
    const match = URL_PATTERN.exec(arg);
    if (match) {
      return match[0];
    }
  }

  const index = args.findIndex((arg) => arg.toLowerCase() === '-encodedcommand');
  if (index >= 0 && index + 1 < args.length) {
    try {
      const decoded = Buffer.from(args[index + 1], 'base64').toString('utf16le');
      const match = URL_PATTERN.exec(decoded);
      if (match) {
        return match[0];
      }
    } catch {
      // Not decodable: not the call we are looking for.
    }
  }

  return undefined;
}

function install(): void {
  const originalSpawn = childProcess.spawn as unknown as (...params: unknown[]) => unknown;

  const patchedSpawn = function (...params: unknown[]): unknown {
    const args = Array.isArray(params[1]) ? (params[1] as string[]) : [];
    const url = findUrl(args);
    if (!url) {
      return originalSpawn.apply(childProcess, params);
    }

    const browser = originalSpawn(browserPath, [url], {
      detached: true,
      stdio: 'ignore'
    }) as import('child_process').ChildProcess;

    browser.once('spawn', () => report('ok', `Opened ${url} with ${browserPath}`));
    browser.once('error', (err: Error) =>
      report('error', `Could not start the browser (${browserPath}): ${err.message}`)
    );
    browser.unref();

    // Adobe's adapter waits for the 'close' event of the process it spawned. Browsers can stay running
    // for hours, so hand back a stand-in that "finishes" right away, as PowerShell's Start does.
    const standIn = new EventEmitter() as EventEmitter & { unref: () => void; kill: () => boolean };
    standIn.unref = () => undefined;
    standIn.kill = () => false;
    setImmediate(() => standIn.emit('close', 0));
    return standIn;
  };

  (childProcess as unknown as Record<string, unknown>).spawn = patchedSpawn;
}

if (!adapterPath || !fs.existsSync(adapterPath)) {
  report('error', `Adobe's debug adapter was not found at '${adapterPath}'.`);
  process.exit(1);
}

if (browserPath) {
  try {
    install();
  } catch (err) {
    report('error', `Could not intercept the browser launch: ${(err as Error).message}`);
  }
}

require(adapterPath);
