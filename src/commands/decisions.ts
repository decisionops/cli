import { DopsClient } from "../core/api-client.js";
import { resolveRepoPath } from "../core/git.js";
import { promptText, promptSelect } from "../ui/prompts.js";
import { resetFlowState } from "../ui/flow-state.js";

type RepoFlags = { repoPath?: string };

async function clientFromFlags(flags: RepoFlags): Promise<DopsClient> {
  const repoPath = resolveRepoPath(flags.repoPath) ?? undefined;
  return DopsClient.fromAuth(repoPath);
}

export async function runDecisionsList(flags: { status?: string; type?: string; limit?: string } & RepoFlags): Promise<void> {
  const client = await clientFromFlags(flags);
  const decisions = await client.listDecisions({
    status: flags.status,
    type: flags.type,
    limit: Number(flags.limit) || 20,
  });
  if (decisions.length === 0) { console.log("No decisions found."); return; }
  for (const d of decisions) {
    const status = (d.status ?? "–").padEnd(12);
    const type = (d.type ?? "–").padEnd(12);
    console.log(`${d.id}  ${status}  ${type}  ${d.title ?? "–"}`);
  }
}

export async function runDecisionsGet(id: string, flags: RepoFlags): Promise<void> {
  const client = await clientFromFlags(flags);
  const decision = await client.getDecision(id);
  console.log(`ID:       ${decision.id}`);
  console.log(`Title:    ${decision.title}`);
  console.log(`Status:   ${decision.status}`);
  console.log(`Type:     ${decision.type}`);
  console.log(`Version:  ${decision.version}`);
  if (decision.context) console.log(`Context:  ${decision.context}`);
  if (decision.outcome) console.log(`Outcome:  ${decision.outcome}`);
  if (decision.options?.length) {
    console.log("Options:");
    for (const opt of decision.options) {
      console.log(`  - ${opt.name}${opt.description ? `: ${opt.description}` : ""}`);
      if (opt.pros?.length) console.log(`    Pros: ${opt.pros.join(", ")}`);
      if (opt.cons?.length) console.log(`    Cons: ${opt.cons.join(", ")}`);
    }
  }
  if (decision.consequences?.length) {
    console.log("Consequences:");
    for (const c of decision.consequences) console.log(`  - ${c}`);
  }
  console.log(`Created:  ${decision.createdAt}`);
  console.log(`Updated:  ${decision.updatedAt}`);
}

export async function runDecisionsSearch(terms: string, flags: { mode?: string } & RepoFlags): Promise<void> {
  const client = await clientFromFlags(flags);
  const result = await client.searchDecisions(terms, flags.mode as "semantic" | "keyword" | undefined);
  if (result.decisions.length === 0) { console.log("No matching decisions found."); return; }
  console.log(`Found ${result.total} result${result.total === 1 ? "" : "s"}:`);
  for (const d of result.decisions) {
    console.log(`  ${d.id}  ${d.status.padEnd(12)}  ${d.title}`);
  }
}

export async function runDecisionsCreate(flags: RepoFlags): Promise<void> {
  resetFlowState();
  const client = await clientFromFlags(flags);

  const title = await promptText({
    title: "Decision title",
    placeholder: "What decision are you recording?",
    validate: (v) => v.length > 0 ? null : "Title is required.",
  });

  const type = await promptSelect<"technical" | "product" | "business" | "governance">(
    "Decision type",
    [
      { label: "Technical", value: "technical", description: "Architecture, tooling, infrastructure" },
      { label: "Product", value: "product", description: "Features, UX, roadmap" },
      { label: "Business", value: "business", description: "Strategy, process, organization" },
      { label: "Governance", value: "governance", description: "Policies, standards, compliance" },
    ],
  );

  const context = await promptText({
    title: "Context (what prompted this decision?)",
    placeholder: "Describe the situation...",
  });

  const result = await client.createDecision({ title, type, context: context || undefined });
  console.log(`Created decision: ${result.decision_id} (v${result.version})`);
}
