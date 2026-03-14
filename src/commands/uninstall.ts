import { resolveRepoPath } from "../core/git.js";
import { cleanupPlatforms } from "../core/installer.js";
import { readAuthState, revokeAuthState, clearAuthState } from "../core/auth.js";
import { loadPlatforms } from "../core/platforms.js";
import { promptSelect, promptConfirm } from "../ui/prompts.js";
import { withSpinner } from "../ui/spinner.js";
import { renderCleanupSummary } from "../ui/output.js";
import { resetFlowState, flowChrome } from "../ui/flow-state.js";
import { findPlatformsDir } from "../core/resources.js";

type UninstallFlags = {
  platform?: string[];
  repoPath?: string;
  skillName?: string;
  serverName?: string;
  skipSkill?: boolean;
  skipMcp?: boolean;
  skipAuth?: boolean;
  removeManifest?: boolean;
  removeAuthHandoff?: boolean;
};

function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export async function runUninstall(flags: UninstallFlags): Promise<void> {
  resetFlowState();
  const platformsDir = findPlatformsDir();
  let selectedPlatforms = flags.platform;

  if (!selectedPlatforms || selectedPlatforms.length === 0) {
    if (!isInteractive()) throw new Error("No platform selected. Use --platform in non-interactive mode.");
    const platforms = Object.values(loadPlatforms(platformsDir));
    const chosen = new Set<string>();
    let addAnother = true;
    while (addAnother) {
      const platformId = await promptSelect(
        "Choose a platform to clean up",
        platforms.map((p) => ({ label: p.display_name, value: p.id })),
        flowChrome({ eyebrow: "Uninstall" }),
      );
      chosen.add(platformId);
      const remaining = platforms.filter((p) => !chosen.has(p.id));
      if (remaining.length === 0) break;
      addAnother = await promptConfirm("Add another platform?", false, flowChrome({ eyebrow: "Uninstall" }));
    }
    selectedPlatforms = [...chosen];
  }

  const repoPath = resolveRepoPath(flags.repoPath);

  const result = cleanupPlatforms({
    platformsDir,
    selectedPlatforms,
    repoPath,
    skillName: flags.skillName,
    serverName: flags.serverName,
    removeSkill: !(flags.skipSkill ?? false),
    removeMcp: !(flags.skipMcp ?? false),
    removeManifest: flags.removeManifest ?? false,
    removeAuthHandoff: flags.removeAuthHandoff ?? false,
  });
  renderCleanupSummary(result);

  if (!(flags.skipAuth ?? false)) {
    const current = readAuthState();
    if (current) {
      await withSpinner("Revoking session...", () => revokeAuthState(current));
      clearAuthState();
      console.log("Removed local auth state.");
    }
  }
}
