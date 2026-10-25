/**
 * Wrapper around Adobe's debug adapter that redirects the "open the browser" step.
 *
 * Runs inside the debug adapter process, NOT in the extension host. It is started by VS Code as
 * `node adapterWrapper.js <path to Adobe's adapter.js>`.
 *
 * **Never write to stdout here**: it carries the Debug Adapter Protocol traffic.
 *
 * It patches `child_process.spawn` in memory so that, when Adobe's adapter asks the operating system
 * to open the debug URL, the browser chosen by the user is used instead. Adobe's files are not
 * modified. Then it loads Adobe's adapter, which starts exactly as if VS Code had launched it directly.
 *
 * Inputs: the adapter path in `process.argv[2]`, and the environment variables `CFBL_BROWSER_PATH`
 * (browser executable) and `CFBL_STATUS_FILE` (file where the outcome is reported to the extension).
 *
 * @packageDocumentation
 */
import { EventEmitter } from 'events';
import * as fs from 'fs';

/**
 * The real `child_process` module object.
 *
 * `require()` on purpose: an `import * as` namespace may be a copy, and we must patch the real one.
 */
const childProcess: typeof import('child_process') = require('child_process');

/** Path of Adobe's `adapter.js`, passed by the extension as the first argument. */
const adapterPath = process.argv[2];

/** Executable of the browser the user chose. Empty means "do not redirect". */
const browserPath = process.env.CFBL_BROWSER_PATH ?? '';

/** File the extension watches to learn how the browser launch went. Empty means "do not report". */
const statusFile = process.env.CFBL_STATUS_FILE ?? '';

/** Matches an http(s) URL inside a command-line argument. */
const URL_PATTERN = /https?:\/\/[^\s"'`]+/i;

/**
 * Tells the extension how the browser launch went, by appending one JSON line to the status file.
 *
 * @param status - `ok` when the chosen browser was started, `error` otherwise.
 * @param message - Human-readable detail shown to the user.
 */
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

/**
 * Finds the URL in the arguments of a `spawn` call.
 *
 * Adobe's adapter uses the `open` package, which on Windows runs
 * `powershell ... -EncodedCommand <base64 (UTF-16LE) of: Start -Wait "http://...">`, so the URL may be
 * hidden inside the encoded command.
 *
 * @param args - The arguments passed to `spawn`.
 * @returns The URL, or `undefined` when this is not a call that opens a page.
 */
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

/**
 * Replaces `child_process.spawn` with a version that redirects calls opening a URL.
 *
 * Any call without a URL is passed through unchanged. For a call with a URL, the chosen browser is
 * started instead and the outcome is reported. Adobe's adapter waits for the 'close' event of the
 * process it spawned, so a stand-in that finishes right away is returned (browsers can stay open for
 * hours, while PowerShell's `Start` returns immediately).
 */
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