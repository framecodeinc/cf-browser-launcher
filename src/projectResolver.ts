import * as fs from 'fs';
import * as path from 'path';

// Kept free of any `vscode` import so it can be tested on its own.

export interface AdobeProject {
  id?: string;
  label?: string;
  path?: string;
  server?: string;
  folders?: { path?: string }[];
  linkedFolders?: { path?: string }[];
  [key: string]: unknown;
}

interface Candidate {
  project: AdobeProject;
  folders: string[];
}

interface GlobalConfig {
  projects?: AdobeProject[];
}

function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

function normalizeDir(dir: string): string {
  const normalized = path.normalize(dir).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function containsFile(dir: string, file: string): boolean {
  const d = normalizeDir(dir);
  const f = normalizeDir(file);
  return f === d || f.startsWith(d + path.sep);
}

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

// A project the Adobe debugger can work with: it needs an id, the server it runs on and at least one folder.
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

const SCAN_SKIP = new Set(['node_modules', '.git', '.vscode', '.svn']);
const SCAN_MAX_DEPTH = 4;
const SCAN_MAX_DIRS = 3000;

// Adobe builds its list of open projects by scanning the workspace folders: every project folder has
// <folder>/.vscode/<LABEL>.cfproject (JSON with the project's id, server, folders and linked folders).
// This does the same scan, so the project of a file can be found without asking.
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

// Finds the Adobe ColdFusion Builder project that owns a file, so Adobe's "select project" prompt can be
// skipped. A file belongs to a project when it is inside the project folder, one of its folders or one of
// its linked folders. Candidates come from:
//   1. the .cfproject files of the workspace folders (what Adobe itself scans),
//   2. projects remembered from earlier debug sessions (full project data), and
//   3. adobe-cfml.json, if Adobe lists projects there (details may also be in <path>/.vscode/<LABEL>.cfproject).
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
