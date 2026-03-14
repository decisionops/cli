import {
  clearAuthState,
  defaultClientId,
  defaultScopes,
  loginWithPkce,
  readAuthState,
  revokeAuthState,
  saveTokenAuthState,
} from "../core/auth.js";
import { promptText } from "../ui/prompts.js";
import { withSpinner } from "../ui/spinner.js";
import { runLoginFlow } from "../ui/flows/login.js";
import { resetFlowState } from "../ui/flow-state.js";

type LoginFlags = {
  apiBaseUrl?: string;
  issuerUrl?: string;
  clientId?: string;
  audience?: string;
  scopes?: string;
  web?: boolean;
  withToken?: boolean;
  token?: string;
  noBrowser?: boolean;
  clear?: boolean;
};

function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function parseScopes(raw?: string): string[] | undefined {
  if (!raw) return undefined;
  return raw.split(/[,\s]+/).map((v) => v.trim()).filter(Boolean);
}

export async function runLogin(flags: LoginFlags): Promise<void> {
  resetFlowState();
  const scopes = parseScopes(flags.scopes);
  const authOptions = {
    apiBaseUrl: flags.apiBaseUrl,
    issuerUrl: flags.issuerUrl,
    clientId: flags.clientId,
    audience: flags.audience,
    scopes,
  };

  if (flags.clear) {
    const current = readAuthState();
    if (current) {
      await withSpinner("Revoking session...", () => revokeAuthState(current));
    }
    clearAuthState();
    console.log("Cleared saved auth state.");
    return;
  }

  if (flags.withToken) {
    const token = flags.token ?? (isInteractive()
      ? await promptText({
          title: "Paste your DecisionOps access token",
          chrome: {
            eyebrow: "Auth",
            description: "Use this fallback for automation or environments where browser OAuth login is unavailable.",
          },
          placeholder: "dop_...",
          secret: true,
          validate: (value) => (value.length > 0 ? null : "Token is required."),
        })
      : "");
    if (!token) throw new Error("Token is required. Pass --token in non-interactive mode.");
    const result = saveTokenAuthState({ ...authOptions, token });
    console.log(`Saved auth token -> ${result.storagePath}`);
    return;
  }

  if (!flags.web && !isInteractive()) {
    throw new Error("Choose --web or --with-token in non-interactive mode.");
  }

  const flowResult = await runLoginFlow({
    initialMethod: flags.web ? "web" : undefined,
    clientDisplay: flags.clientId ?? defaultClientId(),
    scopesDisplay: (scopes ?? defaultScopes()).join(" "),
    loginWithBrowser: (onAuthorizeUrl) =>
      loginWithPkce({
        ...authOptions,
        openBrowser: !(flags.noBrowser ?? false),
        onAuthorizeUrl,
      }),
    saveToken: (token) => saveTokenAuthState({ ...authOptions, token }),
  });
  console.log(`Saved -> ${flowResult.storagePath}`);
  console.log(`Authenticated as ${flowResult.display}`);
}
