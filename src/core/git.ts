import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

export function gitOutput(repoPath: string, ...args: string[]): string {
  const completed = spawnSync("git", ["-C", repoPath, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (completed.status !== 0) {
    throw new Error((completed.stderr || completed.stdout || "git command failed").trim());
  }
  return completed.stdout.trim();
}

export function inferRepoRef(repoPath: string): string {
  const remoteUrl = gitOutput(repoPath, "remote", "get-url", "origin").replace(/\.git$/, "");
  for (const prefix of ["git@github.com:", "https://github.com/", "http://github.com/"]) {
    if (remoteUrl.startsWith(prefix)) return remoteUrl.slice(prefix.length);
  }
  return remoteUrl;
}

export function inferDefaultBranch(repoPath: string): string {
  try {
    return gitOutput(repoPath, "branch", "--show-current") || "main";
  } catch {
    return "main";
  }
}

export function findRepoRoot(startPath = process.cwd()): string | null {
  try {
    return gitOutput(startPath, "rev-parse", "--show-toplevel");
  } catch {
    return null;
  }
}

export function resolveRepoPath(repoPath?: string): string | null {
  if (repoPath) return path.resolve(repoPath);
  return findRepoRoot();
}

export function gitDiff(repoPath: string, base?: string): string {
  try {
    if (base) return gitOutput(repoPath, "diff", "--name-only", base);
    return gitOutput(repoPath, "diff", "--name-only", "HEAD");
  } catch {
    return "";
  }
}

export function gitChangedFiles(repoPath: string): string[] {
  const diff = gitDiff(repoPath);
  return diff ? diff.split("\n").filter(Boolean) : [];
}
