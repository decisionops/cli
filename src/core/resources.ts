import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function directoryHasTomlFiles(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory() && fs.readdirSync(dirPath).some((entry) => entry.endsWith(".toml"));
  } catch {
    return false;
  }
}

function isSkillBundleDir(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory() && fs.existsSync(path.join(dirPath, "SKILL.md"));
  } catch {
    return false;
  }
}

function ancestorDirs(start: string): string[] {
  const dirs: string[] = [];
  let current = path.resolve(start);
  while (true) {
    dirs.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return dirs;
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.map((value) => path.resolve(value)))];
}

function searchRoots(overrides?: string[]): string[] {
  const defaults = [import.meta.dir, process.cwd(), path.dirname(process.execPath)];
  return uniquePaths(overrides && overrides.length > 0 ? overrides : defaults);
}

function findResourceDir(
  candidates: string[][],
  matcher: (dirPath: string) => boolean,
  errorMessage: string,
  roots?: string[],
): string {
  for (const root of searchRoots(roots)) {
    for (const base of ancestorDirs(root)) {
      for (const segments of candidates) {
        const candidate = path.join(base, ...segments);
        if (matcher(candidate)) return candidate;
      }
    }
  }
  throw new Error(errorMessage);
}

export function findPlatformsDir(roots?: string[]): string {
  return findResourceDir(
    [
      ["node_modules", "@decisionops", "skill", "platforms"],
      ["skill", "platforms"],
      ["platforms"],
    ],
    directoryHasTomlFiles,
    "Could not find platform definitions. Ensure @decisionops/skill is installed or is adjacent.",
    roots,
  );
}

export function findSkillSourceDir(roots?: string[]): string {
  return findResourceDir(
    [
      ["node_modules", "@decisionops", "skill", "decision-ops"],
      ["skill", "decision-ops"],
      ["decision-ops"],
    ],
    isSkillBundleDir,
    "Could not find DecisionOps skill bundle. Pass --source-dir or install @decisionops/skill.",
    roots,
  );
}
