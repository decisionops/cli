import { readAuthState, ensureValidAuthState } from "../core/auth.js";
import { renderAuthStatus } from "../ui/output.js";

export async function runAuthStatus(): Promise<void> {
  const current = readAuthState();
  if (!current) {
    console.log("Auth: missing");
    process.exitCode = 1;
    return;
  }
  const auth = await ensureValidAuthState(current);
  renderAuthStatus(auth);
}
