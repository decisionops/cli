import { DopsClient } from "../core/api-client.js";
import { resolveRepoPath, gitChangedFiles, findRepoRoot } from "../core/git.js";
import { promptText } from "../ui/prompts.js";
import { withSpinner } from "../ui/spinner.js";

type GateFlags = { task?: string; repoPath?: string };

export async function runGate(flags: GateFlags): Promise<void> {
  const repoPath = resolveRepoPath(flags.repoPath) ?? undefined;
  const client = await DopsClient.fromAuth(repoPath);

  let taskSummary = flags.task;
  if (!taskSummary) {
    if (!process.stdin.isTTY) throw new Error("--task is required in non-interactive mode.");
    taskSummary = await promptText({
      title: "What task are you working on?",
      placeholder: "Describe the task or change...",
      validate: (v) => v.length > 0 ? null : "Task summary is required.",
    });
  }

  const root = repoPath ?? findRepoRoot() ?? undefined;
  const changedPaths = root ? gitChangedFiles(root) : [];

  const result = await withSpinner("Running decision gate...", () =>
    client.prepareGate(taskSummary!, changedPaths.length > 0 ? changedPaths : undefined),
  );

  console.log(`Recordable:  ${result.recordable ? "yes" : "no"}`);
  console.log(`Confidence:  ${(result.confidence * 100).toFixed(0)}%`);
  console.log(`Reasoning:   ${result.reasoning}`);
  if (result.suggestedType) console.log(`Type:        ${result.suggestedType}`);
}
