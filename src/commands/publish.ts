import { DopsClient } from "../core/api-client.js";
import { resolveRepoPath } from "../core/git.js";
import { withSpinner } from "../ui/spinner.js";

export async function runPublish(id: string, flags: { version?: string; repoPath?: string }): Promise<void> {
  const repoPath = resolveRepoPath(flags.repoPath) ?? undefined;
  const client = await DopsClient.fromAuth(repoPath);
  const version = flags.version ? Number(flags.version) : undefined;

  const result = await withSpinner("Publishing decision...", () => client.publishDecision(id, version));
  console.log(`Published: ${result.decision_id} (v${result.version})`);
}
