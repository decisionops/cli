import { DopsClient } from "../core/api-client.js";
import { resolveRepoPath } from "../core/git.js";
import { withSpinner } from "../ui/spinner.js";

export async function runValidate(id: string | undefined, flags: { repoPath?: string }): Promise<void> {
  if (!id) throw new Error("Decision ID is required: dops validate <id>");
  const repoPath = resolveRepoPath(flags.repoPath) ?? undefined;
  const client = await DopsClient.fromAuth(repoPath);

  const result = await withSpinner("Validating decision...", () => client.validateDecision(id));

  console.log(`Valid: ${result.valid ? "yes" : "no"}`);
  if (result.errors.length > 0) {
    console.log("Errors:");
    for (const e of result.errors) console.log(`  - ${e}`);
  }
  if (result.warnings.length > 0) {
    console.log("Warnings:");
    for (const w of result.warnings) console.log(`  - ${w}`);
  }
}
