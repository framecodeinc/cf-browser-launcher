/**
 * Finds the Adobe ColdFusion Builder project that owns a file.
 *
 * Kept free of any `vscode` import so it can be tested on its own.
 * @packageDocumentation
 */
import * as fs from 'fs';
import * as path from 'path';

/**
 * A ColdFusion Builder project, as Adobe describes it in its `.cfproject` files and debug sessions.
 * Only the fields this extension reads are listed; the rest are kept untouched and passed on to
 * Adobe's debugger as they are.
 */
export interface AdobeProject {
  /** Unique id of the project. */
  id?: string;
  /** Display name; also the name of the `<LABEL>.cfproject` file. */
  label?: string;
  /** Folder of the project. */
  path?: string;
  /** Id of the ColdFusion server the project runs on. */
  server?: string;
  /** Folders of the project. */
  folders?: { path?: string }[];
  /** Folders linked into the project, e.g. a copy under the server's web root. */
  linkedFolders?: { path?: string }[];
  [key: string]: unknown;
}

/** A project together with every folder that belongs to it. */
interface Candidate {
  project: AdobeProject;
  folders: string[];
}

/** The part of Adobe's `adobe-cfml.json` this module reads. */
interface GlobalConfig {
  projects?: AdobeProject[];
}

/**
 * Reads and parses a JSON file.
 *
 * @param file - Path of the file.
 * @returns The parsed content, or `undefined` if the file is missing or isn't valid JSON.
 */
function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

/**
 * Normalizes a folder path for comparison: no trailing separator, and lower case on Windows, where
 * paths are not case-sensitive.
 */
function normalizeDir(dir: string): string {
  const normalized = path.normalize(dir).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/**
 * @param dir - A folder.
 * @param file - A file path.
 * @returns Whether the file is that folder or is inside it (a sibling with the same prefix is not).
 */
function containsFile(dir: string, file: string): boolean {
  const d = normalizeDir(dir);
  const f = normalizeDir(file);
  return f === d || f.startsWith(d + path.sep);
}

/** @returns Every folder of a project: its own path, its folders and its linked folders. */
function folderPaths(project: AdobeProject | undefined): string[] {
  if (!project) {
    return [];
  }
  const folders: unknown[] = [
    project.path,
    ...(project.folders ?? []).map((f) => f.path),
    ...(project.linkedFolders ?? []).map((f) => f.path)
  ];
  return folders.filter((f): f is string => typeof f === 'string' && f.length > 0);
}

/**
 * Checks that a value is a project Adobe's debugger can work with: it needs an id, the server it
 * runs on and at least one folder.
 *
 * @param value - Anything, typically parsed from JSON.
 * @returns Whether it is a usable project (also narrows the type).
 */
export function isUsableProject(value: unknown): value is AdobeProject {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const project = value as AdobeProject;
  return (
    typeof project.id === 'string' &&
    typeof project.server === 'string' &&
    folderPaths(project).length > 0
  );
}

/** Folders that are never searched for projects. */
const SCAN_SKIP = new Set(['node_modules', '.git', '.vscode', '.svn']);

/** How many levels below a workspace folder are searched. */
const SCAN_MAX_DEPTH = 4;

/** Safety limit on the number of folders visited in one scan. */
const SCAN_MAX_DIRS = 3000;

/**
 * Finds the projects in the workspace folders.
 *
 * Adobe builds its list of open projects by scanning the workspace folders: every project folder has
 * `<folder>/.vscode/<LABEL>.cfproject` (JSON with the project's id, server, folders and linked
 * folders). This does the same scan, so the project of a file can be found without asking.
 *
 * @param roots - The workspace folders to search.
 * @returns The usable projects found, without duplicates.
 */
export function scanWorkspaceProjects(roots: string[]): AdobeProject[] {
  const found: AdobeProject[] = [];
  const seenIds = new Set<string>();
  let visited = 0;

  const visit = (dir: string, depth: number): void => {
    if (visited++ >= SCAN_MAX_DIRS) {
      return;
    }

    try {
      for (const name of fs.readdirSync(path.join(dir, '.vscode'))) {
        if (!name.toLowerCase().endsWith('.cfproject')) {
          continue;
        }
        const project = readJson<AdobeProject>(path.join(dir, '.vscode', name));
        if (isUsableProject(project) && !seenIds.has(String(project.id))) {
          seenIds.add(String(project.id));
          found.push(project);
        }
      }
    } catch {
      // No .vscode folder here.
    }

    if (depth >= SCAN_MAX_DEPTH) {
      return;
    }
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory() && !SCAN_SKIP.has(entry.name.toLowerCase())) {
          visit(path.join(dir, entry.name), depth + 1);
        }
      }
    } catch {
      // Unreadable folder: skip it.
    }
  };

  for (const root of roots) {
    visit(root, 0);
  }
  return found;
}

/**
 * Finds the project that owns a file, so Adobe's "select project" prompt can be skipped.
 *
 * A file belongs to a project when it is inside the project folder, one of its folders or one of its
 * linked folders. Candidates come from, in this order:
 * 1. the `.cfproject` files of the workspace folders (what Adobe itself scans),
 * 2. projects remembered from earlier debug sessions (full project data), and
 * 3. `adobe-cfml.json`, if Adobe lists projects there (details may also be in
 *    `<path>/.vscode/<LABEL>.cfproject`).
 *
 * The most specific folder wins. If two different projects claim the file equally, there is no answer
 * and Adobe's own prompt decides.
 *
 * @param globalConfigFile - Path of Adobe's `adobe-cfml.json`, if it exists.
 * @param file - The file to find the project of.
 * @param remembered - Projects remembered from earlier debug sessions.
 * @param workspaceRoots - The workspace folders to scan.
 * @returns The project, or `undefined` when none (or more than one) matches.
 */
export function findProject(
  globalConfigFile: string | undefined,
  file: string,
  remembered: AdobeProject[],
  workspaceRoots: string[] = []
): AdobeProject | undefined {
  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  for (const project of scanWorkspaceProjects(workspaceRoots)) {
    seen.add(String(project.id));
    candidates.push({ project, folders: folderPaths(project) });
  }

  for (const project of remembered) {
    if (isUsableProject(project) && !seen.has(String(project.id))) {
      seen.add(String(project.id));
      candidates.push({ project, folders: folderPaths(project) });
    }
  }

  const globalConfig = globalConfigFile ? readJson<GlobalConfig>(globalConfigFile) : undefined;
  for (const entry of Array.isArray(globalConfig?.projects) ? globalConfig.projects : []) {
    if (!entry.path || !entry.label || seen.has(String(entry.id))) {
      continue;
    }
    const fromFile = readJson<AdobeProject>(
      path.join(entry.path, '.vscode', `${entry.label.toUpperCase()}.cfproject`)
    );
    const project = fromFile ?? (typeof entry.server === 'string' ? entry : undefined);
    if (project) {
      seen.add(String(entry.id));
      candidates.push({
        project,
        folders: [...new Set([...folderPaths(entry), ...folderPaths(fromFile)])]
      });
    }
  }

  // The most specific folder wins. If two different projects claim a file equally, give up and let
  // Adobe's own "select project" prompt decide.
  let best: Candidate | undefined;
  let bestLength = -1;
  let ambiguous = false;

  for (const candidate of candidates) {
    let matchLength = -1;
    for (const folder of candidate.folders) {
      if (containsFile(folder, file)) {
        matchLength = Math.max(matchLength, normalizeDir(folder).length);
      }
    }
    if (matchLength < 0) {
      continue;
    }

    if (matchLength > bestLength) {
      best = candidate;
      bestLength = matchLength;
      ambiguous = false;
    } else if (matchLength === bestLength && best && best.project.id !== candidate.project.id) {
      ambiguous = true;
    }
  }

  return best && !ambiguous ? best.project : undefined;
}