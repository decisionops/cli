import { resolveRepoPath, inferDefaultBranch, inferRepoRef } from "../core/git.js";
import { writeManifest } from "../core/manifest.js";
import { DEFAULT_MCP_SERVER_NAME, DEFAULT_MCP_SERVER_URL, PLACEHOLDER_ORG_ID, PLACEHOLDER_PROJECT_ID, PLACEHOLDER_REPO_REF } from "../core/config.js";
import { promptText } from "../ui/prompts.js";
import { resetFlowState } from "../ui/flow-state.js";

type InitFlags = {
  repoPath?: string;
  apiBaseUrl?: string;
  orgId?: string;
  projectId?: string;
  repoRef?: string;
  repoId?: string;
  defaultBranch?: string;
  userSessionToken?: string;
  allowPlaceholders?: boolean;
  serverName?: string;
  serverUrl?: string;
};

function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function normalizeRepoRef(value: string): string {
  let normalized = value.trim().replace(/\/+$/, "").replace(/\.git$/i, "");
  for (const prefix of ["git@github.com:", "https://github.com/", "http://github.com/", "ssh://git@github.com/"]) {
    if (normalized.startsWith(prefix)) { normalized = normalized.slice(prefix.length); break; }
  }
  return normalized;
}

function detectRepoRef(repoPath: string): string | undefined {
  try { return normalizeRepoRef(inferRepoRef(repoPath)); } catch { return undefined; }
}

export async function runInit(flags: InitFlags): Promise<void> {
  resetFlowState();
  const repoPath = resolveRepoPath(flags.repoPath);
  if (!repoPath) throw new Error("Could not determine repository path. Use --repo-path.");

  const allowPlaceholders = flags.allowPlaceholders ?? false;
  const detectedRepoRef = flags.repoRef ? normalizeRepoRef(flags.repoRef) : detectRepoRef(repoPath);
  const defaultBranch = flags.defaultBranch ?? inferDefaultBranch(repoPath);

  let orgId = flags.orgId;
  let projectId = flags.projectId;
  let repoRef = detectedRepoRef;

  if (!orgId && !projectId && allowPlaceholders) {
    orgId = PLACEHOLDER_ORG_ID;
    projectId = PLACEHOLDER_PROJECT_ID;
    repoRef = repoRef ?? PLACEHOLDER_REPO_REF;
  } else if (!orgId || !projectId) {
    if (!isInteractive()) {
      throw new Error("--org-id and --project-id are required. Use --allow-placeholders for local prototyping.");
    }
    orgId = orgId ?? await promptText({
      title: "DecisionOps org_id",
      placeholder: allowPlaceholders ? PLACEHOLDER_ORG_ID : "org_...",
      validate: (v) => v.length > 0 ? null : "org_id is required.",
    });
    projectId = projectId ?? await promptText({
      title: "DecisionOps project_id",
      placeholder: allowPlaceholders ? PLACEHOLDER_PROJECT_ID : "proj_...",
      validate: (v) => v.length > 0 ? null : "project_id is required.",
    });
  }

  if (!repoRef) {
    if (allowPlaceholders) {
      repoRef = PLACEHOLDER_REPO_REF;
    } else if (isInteractive()) {
      repoRef = normalizeRepoRef(await promptText({
        title: "Repository reference (owner/repo)",
        placeholder: "owner/repo",
        validate: (v) => v.length > 0 ? null : "repo_ref is required.",
      }));
    } else {
      throw new Error("Could not infer repo_ref. Pass --repo-ref or use --allow-placeholders.");
    }
  }

  const manifestPath = writeManifest(repoPath, {
    org_id: orgId!,
    project_id: projectId!,
    repo_ref: repoRef,
    default_branch: defaultBranch,
    mcp_server_name: flags.serverName ?? DEFAULT_MCP_SERVER_NAME,
    mcp_server_url: flags.serverUrl ?? DEFAULT_MCP_SERVER_URL,
    repo_id: flags.repoId,
  });
  console.log(`Wrote manifest: ${manifestPath}`);
}
