import { resolveRepoPath } from "../core/git.js";
import { installPlatforms } from "../core/installer.js";
import { loadPlatforms } from "../core/platforms.js";
import { promptSelect, promptConfirm } from "../ui/prompts.js";
import { renderInstallSummary } from "../ui/output.js";
import { resetFlowState, flowChrome } from "../ui/flow-state.js";
import { findPlatformsDir, findSkillSourceDir } from "../core/resources.js";

type InstallFlags = {
  platform?: string[];
  repoPath?: string;
  apiBaseUrl?: string;
  orgId?: string;
  projectId?: string;
  repoRef?: string;
  repoId?: string;
  defaultBranch?: string;
  userSessionToken?: string;
  allowPlaceholders?: boolean;
  skipManifest?: boolean;
  skipSkill?: boolean;
  skipMcp?: boolean;
  outputDir?: string;
  sourceDir?: string;
  skillName?: string;
  serverName?: string;
  serverUrl?: string;
  yes?: boolean;
};

function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

async function choosePlatforms(initialIds: string[] | undefined, platformsDir: string): Promise<string[]> {
  if (initialIds && initialIds.length > 0) return initialIds;
  if (!isInteractive()) throw new Error("No platform selected. Use --platform in non-interactive mode.");

  const platforms = Object.values(loadPlatforms(platformsDir));
  const chosen = new Set<string>();
  let addAnother = true;

  while (addAnother) {
    const platformId = await promptSelect(
      "Choose a platform to install",
      platforms.map((p) => ({
        label: p.display_name,
        value: p.id,
        description: `Target id: ${p.id}`,
      })),
      flowChrome({ eyebrow: "Install" }),
    );
    chosen.add(platformId);
    const remaining = platforms.filter((p) => !chosen.has(p.id));
    if (remaining.length === 0) break;
    addAnother = await promptConfirm("Add another platform?", false, flowChrome({ eyebrow: "Install" }));
  }
  return [...chosen];
}

export async function runInstall(flags: InstallFlags): Promise<void> {
  resetFlowState();
  const platformsDir = findPlatformsDir();
  const selectedPlatforms = await choosePlatforms(flags.platform, platformsDir);
  const repoPath = resolveRepoPath(flags.repoPath);
  const sourceDir = !(flags.skipSkill ?? false) ? (flags.sourceDir ?? findSkillSourceDir()) : flags.sourceDir;

  const result = installPlatforms({
    platformsDir,
    selectedPlatforms,
    repoPath,
    orgId: flags.orgId,
    projectId: flags.projectId,
    repoRef: flags.repoRef,
    repoId: flags.repoId,
    defaultBranch: flags.defaultBranch,
    installSkill: !(flags.skipSkill ?? false),
    installMcp: !(flags.skipMcp ?? false),
    writeManifest: !(flags.skipManifest ?? false),
    allowPlaceholders: flags.allowPlaceholders,
    outputDir: flags.outputDir,
    sourceDir,
    skillName: flags.skillName,
    serverName: flags.serverName,
    serverUrl: flags.serverUrl,
  });
  renderInstallSummary(result);
}
