import {
  clearAuthState,
  defaultClientId,
  ensureValidAuthState,
  loginWithPkce,
  readAuthState,
  revokeAuthState,
  saveTokenAuthState,
  type AuthState,
  writeAuthState,
} from "../core/auth.js";
import { loadUserContext, type UserContext } from "../core/api-client.js";
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
  force?: boolean;
};

function parseScopes(raw?: string): string[] | undefined {
  if (!raw) return undefined;
  return raw.split(/[,\s]+/).map((v) => v.trim()).filter(Boolean);
}

function resolveIdentity(context: UserContext | null, fallback?: string): string | undefined {
  return context?.user?.email || context?.user?.displayName || context?.user?.id || fallback;
}

function resolveOrganization(context: UserContext | null): string | undefined {
  const organization = context?.activeOrganization ?? context?.organizations[0];
  if (!organization) return undefined;
  return organization.orgName === organization.orgId
    ? organization.orgName
    : `${organization.orgName} (${organization.orgId})`;
}

function renderAsciiBox(lines: string[]): string {
  const width = lines.reduce((max, line) => Math.max(max, line.length), 0);
  const border = `+${"-".repeat(width + 2)}+`;
  return [
    border,
    ...lines.map((line) => `| ${line.padEnd(width)} |`),
    border,
  ].join("\n");
}

function resolveAuthUser(context: UserContext | null): AuthState["user"] | undefined {
  const email = context?.user?.email?.trim();
  const name = context?.user?.displayName?.trim();
  const id = context?.user?.id?.trim();
  if (!email && !name && !id) return undefined;
  return { ...(id ? { id } : {}), ...(email ? { email } : {}), ...(name ? { name } : {}) };
}

function persistAuthUser(auth: AuthState, context: UserContext | null): AuthState {
  const user = resolveAuthUser(context);
  if (!user) return auth;
  if (auth.user?.id === user.id && auth.user?.email === user.email && auth.user?.name === user.name) {
    return auth;
  }
  const nextState: AuthState = { ...auth, user };
  writeAuthState(nextState);
  return nextState;
}

async function loadSessionContext(token: string, apiBaseUrl?: string): Promise<UserContext | null> {
  try {
    return await withSpinner("Loading DecisionOps workspace...", () => loadUserContext({ token, apiBaseUrl }));
  } catch {
    return null;
  }
}

function printLoginSummary(lines: string[]): void {
  console.log(renderAsciiBox(lines));
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

  if (!flags.withToken && !flags.force) {
    const current = readAuthState();
    if (current) {
      let auth = await withSpinner("Checking existing DecisionOps session...", () => ensureValidAuthState(current));
      const context = await loadSessionContext(auth.accessToken, auth.apiBaseUrl);
      auth = persistAuthUser(auth, context);
      if (context) {
        printLoginSummary([
          "You are already logged into AI DecisionOps",
          ...(resolveOrganization(context) ? [`Logged into org: ${resolveOrganization(context)}`] : ["Saved session is ready to use"]),
          ...(resolveIdentity(context) ? [`Authenticated as: ${resolveIdentity(context)}`] : []),
          "Run `dops logout` if you want to sign in again.",
        ]);
        return;
      }
    }
  }

  if (flags.withToken) {
    const token = flags.token?.trim() ?? "";
    if (!token) {
      throw new Error(
        "Pass --token with an already-issued DecisionOps bearer access token. Raw org API keys are not accepted here.",
      );
    }
    const result = saveTokenAuthState({ ...authOptions, token });
    const context = await loadSessionContext(token, result.state.apiBaseUrl);
    persistAuthUser(result.state, context);
    console.log(`Saved auth token -> ${result.storagePath}`);
    printLoginSummary([
      "Welcome to AI DecisionOps",
      ...(resolveOrganization(context) ? [`Logged into org: ${resolveOrganization(context)}`] : ["Advanced token saved for dops CLI"]),
      ...(resolveIdentity(context) ? [`Authenticated as: ${resolveIdentity(context)}`] : []),
    ]);
    return;
  }

  const flowResult = await runLoginFlow({
    clientDisplay: flags.clientId ?? defaultClientId(),
    loginWithBrowser: (onAuthorizeUrl) =>
      loginWithPkce({
        ...authOptions,
        openBrowser: !(flags.noBrowser ?? false),
        onAuthorizeUrl,
      }),
  });
  const context = await loadSessionContext(flowResult.state.accessToken, flowResult.state.apiBaseUrl);
  const savedState = persistAuthUser(flowResult.state, context);
  const identity = savedState.user?.email || savedState.user?.name || savedState.user?.id || "unknown";
  console.log(`Saved -> ${flowResult.storagePath}`);
  printLoginSummary([
    "Welcome to AI DecisionOps",
    ...(resolveOrganization(context) ? [`Logged into org: ${resolveOrganization(context)}`] : ["Signed into dops CLI successfully"]),
    ...(resolveIdentity(context, identity) ? [`Authenticated as: ${resolveIdentity(context, identity)}`] : []),
  ]);
}
