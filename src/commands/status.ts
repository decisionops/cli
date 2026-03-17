import { DopsClient } from "../core/api-client.js";
import { resolveRepoPath } from "../core/git.js";
import { withSpinner } from "../ui/spinner.js";

export async function runStatus(flags: { repoPath?: string }): Promise<void> {
  const repoPath = resolveRepoPath(flags.repoPath) ?? undefined;
  const client = await DopsClient.fromAuth(repoPath);

  const [snapshot, alerts] = await withSpinner("Loading governance data...", () =>
    Promise.all([client.getMonitoringSnapshot(), client.getAlerts()]),
  );

  console.log("Governance Snapshot");
  console.log(`  Total decisions: ${snapshot.totalDecisions}`);
  console.log(`  Coverage:        ${snapshot.coveragePercent}%`);
  console.log(`  Health:          ${snapshot.healthPercent}%`);
  console.log(`  Drift rate:      ${snapshot.driftRate}`);

  if (snapshot.byStatus && Object.keys(snapshot.byStatus).length > 0) {
    console.log("  By status:");
    for (const [status, count] of Object.entries(snapshot.byStatus)) {
      console.log(`    ${status}: ${count}`);
    }
  }

  if (alerts.length > 0) {
    console.log(`\nAlerts (${alerts.length}):`);
    for (const a of alerts) {
      console.log(`  [${a.severity}] ${a.message}`);
    }
  }
}
