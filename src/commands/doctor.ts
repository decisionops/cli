import fs from "node:fs";
import path from "node:path";
import { readAuthState, ensureValidAuthState, isExpired } from "../core/auth.js";
import { readManifest } from "../core/manifest.js";
import { resolveRepoPath } from "../core/git.js";
import { DEFAULT_SKILL_NAME } from "../core/config.js";
import { loadPlatforms, resolveInstallPath, type PlatformDefinition } from "../core/platforms.js";
import { renderDoctorReport, type DoctorPlatformStatus } from "../ui/output.js";

type DoctorFlags = { repoPath?: string };

function authDisplay(auth: NonNullable<ReturnType<typeof readAuthState>>): string {
  const identity = auth.user?.email || auth.user?.name || auth.user?.id || "unknown";
  const expiry = auth.expiresAt ? `${auth.expiresAt}${isExpired(auth) ? " (expired)" : ""}` : "session";
  return `${identity} via ${auth.method} • ${expiry}`;
}

export async function runDoctor(flags: DoctorFlags): Promise<void> {
  const repoPath = resolveRepoPath(flags.repoPath);
  const currentAuth = readAuthState();
  const auth = currentAuth ? await ensureValidAuthState(currentAuth) : null;
  const issues: string[] = [];

  if (!auth) issues.push("CLI auth not configured");

  const manifest = repoPath ? readManifest(repoPath) : null;
  if (!repoPath) {
    issues.push("Not inside a git repository");
  } else if (!manifest) {
    issues.push("No .decisionops/manifest.toml found");
  } else if (!manifest.org_id || !manifest.project_id || !manifest.repo_ref) {
    issues.push("Manifest is missing required fields (org_id, project_id, or repo_ref)");
  }

  // Try to find platform definitions
  let platformStatuses: DoctorPlatformStatus[] = [];
  try {
    const candidates = [
      path.join(import.meta.dir, "..", "..", "node_modules", "@decisionops", "skill", "platforms"),
      path.join(import.meta.dir, "..", "..", "..", "skill", "platforms"),
    ];
    let platforms: Record<string, PlatformDefinition> = {};
    for (const dir of candidates) {
      try { platforms = loadPlatforms(dir); break; } catch {}
    }
    const context = { skill_name: DEFAULT_SKILL_NAME, repo_path: repoPath ?? "" };
    for (const platform of Object.values(platforms)) {
      const skillPath = platform.skill?.supported ? resolveInstallPath(platform.skill, context) : null;
      const mcpPath = platform.mcp?.supported ? resolveInstallPath(platform.mcp, context) : null;
      platformStatuses.push({
        displayName: platform.display_name,
        skillStatus: !platform.skill?.supported ? "n/a" : skillPath && fs.existsSync(skillPath) ? `installed (${skillPath})` : `not installed`,
        mcpStatus: !platform.mcp?.supported ? "n/a" : mcpPath && fs.existsSync(mcpPath) ? `configured (${mcpPath})` : `not configured`,
      });
    }
  } catch {}

  renderDoctorReport({
    auth,
    authDisplay: auth ? authDisplay(auth) : "",
    repoPath,
    manifest,
    platforms: platformStatuses,
    issues,
  });
}
