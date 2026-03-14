import { readAuthState, revokeAuthState, clearAuthState } from "../core/auth.js";
import { withSpinner } from "../ui/spinner.js";

export async function runLogout(): Promise<void> {
  const current = readAuthState();
  if (!current) {
    console.log("No DecisionOps session stored locally.");
    return;
  }
  await withSpinner("Revoking session...", () => revokeAuthState(current));
  clearAuthState();
  console.log("Logged out and removed the local session.");
}
