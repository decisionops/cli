import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { decisionopsHome } from "./config.js";

export type AuthMethod = "pkce" | "device" | "token";

export type AuthState = {
  apiBaseUrl: string;
  issuerUrl: string;
  clientId: string;
  audience?: string;
  scopes: string[];
  tokenType: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  issuedAt: string;
  method: AuthMethod;
  user?: {
    id?: string;
    email?: string;
    name?: string;
  };
};

export type OAuthDiscovery = {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint?: string;
  userinfoEndpoint?: string;
  issuer: string;
};

export type LoginResult = {
  state: AuthState;
  storagePath: string;
  openedBrowser: boolean;
  authorizationUrl?: string;
  verificationUri?: string;
  userCode?: string;
};

type TokenResponse = {
  access_token: string;
  token_type?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
};

type UserInfo = {
  sub?: string;
  email?: string;
  name?: string;
};

type OAuthOptions = {
  apiBaseUrl?: string;
  issuerUrl?: string;
  clientId?: string;
  audience?: string;
  scopes?: string[];
};

type PkceLoginOptions = OAuthOptions & {
  openBrowser?: boolean;
  callbackPort?: number;
  timeoutMs?: number;
  onAuthorizeUrl?: (url: string) => void;
  signal?: AbortSignal;
};

type RefreshOptions = OAuthOptions & { signal?: AbortSignal };

export const DEFAULT_API_BASE_URL = "https://api.aidecisionops.com";
export const DEFAULT_OAUTH_ISSUER_URL = "https://auth.aidecisionops.com/oauth";
export const DEFAULT_OAUTH_CLIENT_ID = "decisionops-cli";
export const DEFAULT_OAUTH_SCOPES = ["mcp:read", "mcp:call", "decisions:read", "decisions:write", "decisions:approve", "admin:read"];
export const DEFAULT_OAUTH_API_AUDIENCE = "https://api.aidecisionops.com/v1";

function authPath(): string {
  return path.join(decisionopsHome(), "auth.json");
}

function secureWrite(filePath: string, value: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, { encoding: "utf8", mode: 0o600 });
}

async function parseJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Expected JSON response from ${response.url}, received: ${text.slice(0, 240)}`);
  }
}

async function postForm(url: string, body: Record<string, string>, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const params = new URLSearchParams(body);
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: params,
    signal,
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    const errorMessage = String(payload.error_description ?? payload.error ?? response.statusText);
    throw new Error(`Auth request failed (${response.status}): ${errorMessage}`);
  }
  return payload;
}

async function getJson(url: string, accessToken?: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    signal,
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    const errorMessage = String(payload.error_description ?? payload.error ?? response.statusText);
    throw new Error(`Request failed (${response.status}): ${errorMessage}`);
  }
  return payload;
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function sha256(value: string): string {
  return base64UrlEncode(createHash("sha256").update(value).digest());
}

function generateVerifier(): string {
  return base64UrlEncode(randomBytes(48));
}

function generateState(): string {
  return base64UrlEncode(randomBytes(24));
}

function normalizeScopes(scopes?: string[]): string[] {
  const source = scopes && scopes.length > 0 ? scopes : DEFAULT_OAUTH_SCOPES;
  return [...new Set(source.map((scope) => scope.trim()).filter(Boolean))];
}

function resolveOAuthOptions(options?: OAuthOptions) {
  const apiBaseUrl = options?.apiBaseUrl ?? DEFAULT_API_BASE_URL;
  const issuerUrl = options?.issuerUrl ?? DEFAULT_OAUTH_ISSUER_URL;
  return {
    apiBaseUrl,
    issuerUrl,
    clientId: options?.clientId ?? DEFAULT_OAUTH_CLIENT_ID,
    audience: options?.audience ?? DEFAULT_OAUTH_API_AUDIENCE,
    scopes: normalizeScopes(options?.scopes),
  };
}

export async function discoverOAuth(options?: OAuthOptions & { signal?: AbortSignal }): Promise<OAuthDiscovery> {
  const resolved = resolveOAuthOptions(options);
  const candidates = [
    new URL("/.well-known/oauth-authorization-server", resolved.issuerUrl).toString(),
    new URL("/.well-known/openid-configuration", resolved.issuerUrl).toString(),
  ];

  for (const candidate of candidates) {
    try {
      const payload = await getJson(candidate, undefined, options?.signal);
      const authorizationEndpoint = String(payload.authorization_endpoint ?? "");
      const tokenEndpoint = String(payload.token_endpoint ?? "");
      if (authorizationEndpoint && tokenEndpoint) {
        return {
          authorizationEndpoint,
          tokenEndpoint,
          revocationEndpoint: payload.revocation_endpoint ? String(payload.revocation_endpoint) : undefined,
          userinfoEndpoint: payload.userinfo_endpoint ? String(payload.userinfo_endpoint) : undefined,
          issuer: String(payload.issuer ?? resolved.issuerUrl),
        };
      }
    } catch {
      continue;
    }
  }

  return {
    authorizationEndpoint: new URL("/oauth/authorize", resolved.issuerUrl).toString(),
    tokenEndpoint: new URL("/oauth/token", resolved.issuerUrl).toString(),
    revocationEndpoint: new URL("/oauth/revoke", resolved.issuerUrl).toString(),
    userinfoEndpoint: new URL("/oauth/userinfo", resolved.issuerUrl).toString(),
    issuer: resolved.issuerUrl,
  };
}

async function fetchUserInfo(discovery: OAuthDiscovery, accessToken: string, signal?: AbortSignal): Promise<UserInfo | undefined> {
  if (!discovery.userinfoEndpoint) return undefined;
  try {
    const payload = await getJson(discovery.userinfoEndpoint, accessToken, signal);
    return {
      sub: payload.sub ? String(payload.sub) : undefined,
      email: payload.email ? String(payload.email) : undefined,
      name: payload.name ? String(payload.name) : undefined,
    };
  } catch {
    return undefined;
  }
}

function buildAuthState(
  token: TokenResponse,
  method: AuthMethod,
  resolved: ReturnType<typeof resolveOAuthOptions>,
  discovery: OAuthDiscovery,
  userInfo?: UserInfo,
): AuthState {
  const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : undefined;
  return {
    apiBaseUrl: resolved.apiBaseUrl,
    issuerUrl: discovery.issuer,
    clientId: resolved.clientId,
    audience: resolved.audience,
    scopes: token.scope ? token.scope.split(/\s+/).filter(Boolean) : resolved.scopes,
    tokenType: token.token_type ?? "Bearer",
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt,
    issuedAt: new Date().toISOString(),
    method,
    user: userInfo ? { id: userInfo.sub, email: userInfo.email, name: userInfo.name } : undefined,
  };
}

export function readAuthState(): AuthState | null {
  const filePath = authPath();
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as Partial<AuthState>;
  if (!parsed.accessToken) return null;
  return {
    apiBaseUrl: parsed.apiBaseUrl || DEFAULT_API_BASE_URL,
    issuerUrl: parsed.issuerUrl || parsed.apiBaseUrl || DEFAULT_OAUTH_ISSUER_URL,
    clientId: parsed.clientId || DEFAULT_OAUTH_CLIENT_ID,
    audience: parsed.audience,
    scopes: Array.isArray(parsed.scopes) ? parsed.scopes.map(String) : DEFAULT_OAUTH_SCOPES,
    tokenType: parsed.tokenType || "Bearer",
    accessToken: parsed.accessToken,
    refreshToken: parsed.refreshToken,
    expiresAt: parsed.expiresAt,
    issuedAt: parsed.issuedAt || new Date().toISOString(),
    method: (parsed.method as AuthMethod | undefined) || "token",
    user: parsed.user,
  };
}

export function writeAuthState(auth: AuthState): string {
  const filePath = authPath();
  secureWrite(filePath, `${JSON.stringify(auth, null, 2)}\n`);
  return filePath;
}

export function clearAuthState(): void {
  const filePath = authPath();
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

export function defaultApiBaseUrl(): string {
  return DEFAULT_API_BASE_URL;
}

export function defaultClientId(): string {
  return DEFAULT_OAUTH_CLIENT_ID;
}

export function defaultScopes(): string[] {
  return [...DEFAULT_OAUTH_SCOPES];
}

export function saveTokenAuthState(options: {
  apiBaseUrl?: string;
  issuerUrl?: string;
  clientId?: string;
  audience?: string;
  scopes?: string[];
  token: string;
}): { state: AuthState; storagePath: string } {
  const resolved = resolveOAuthOptions(options);
  const state: AuthState = {
    apiBaseUrl: resolved.apiBaseUrl,
    issuerUrl: resolved.issuerUrl,
    clientId: resolved.clientId,
    audience: resolved.audience,
    scopes: resolved.scopes,
    tokenType: "Bearer",
    accessToken: options.token,
    issuedAt: new Date().toISOString(),
    method: "token",
  };
  const storagePath = writeAuthState(state);
  return { state, storagePath };
}

export function isExpired(auth: AuthState, skewSeconds = 30): boolean {
  if (!auth.expiresAt) return false;
  return Date.parse(auth.expiresAt) <= Date.now() + skewSeconds * 1000;
}

function openBrowser(url: string): boolean {
  const platform = os.platform();
  const commands: Array<[string, string[]]> =
    platform === "darwin"
      ? [["open", [url]]]
      : platform === "win32"
        ? [["cmd", ["/c", "start", "", url]]]
        : [["xdg-open", [url]], ["gio", ["open", url]]];

  for (const [command, args] of commands) {
    try {
      const child = spawn(command, args, { detached: true, stdio: "ignore" });
      child.unref();
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

function extractCallbackParams(urlValue: string): Record<string, string> {
  const url = new URL(urlValue);
  const params: Record<string, string> = {};
  for (const [key, value] of url.searchParams.entries()) {
    params[key] = value;
  }
  return params;
}

// KEY CHANGE: Uses Bun.serve instead of Node.js createServer
async function startOAuthCallbackServer(callbackPort = 0, timeoutMs = 120_000, signal?: AbortSignal): Promise<{
  callbackUrl: string;
  waitForCallback: Promise<{ callbackUrl: string; params: Record<string, string> }>;
}> {
  let callbackResolve!: (value: { callbackUrl: string; params: Record<string, string> }) => void;
  let callbackReject!: (reason?: unknown) => void;
  const waitForCallback = new Promise<{ callbackUrl: string; params: Record<string, string> }>((resolve, reject) => {
    callbackResolve = resolve;
    callbackReject = reject;
  });

  const server = Bun.serve({
    port: callbackPort,
    hostname: "127.0.0.1",
    fetch(req) {
      try {
        const fullUrl = req.url;
        const params = extractCallbackParams(fullUrl);

        const statusCode = params.error ? 400 : 200;
        const html = params.error
          ? "<html><body><h1>DecisionOps login failed</h1><p>You can return to the terminal.</p></body></html>"
          : "<html><body><h1>DecisionOps login complete</h1><p>You can return to the terminal.</p></body></html>";

        server.stop();
        callbackResolve({ callbackUrl: fullUrl, params });

        return new Response(html, {
          status: statusCode,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      } catch (error) {
        server.stop();
        callbackReject(error);
        return new Response("Internal error", { status: 500 });
      }
    },
  });

  const timer = setTimeout(() => {
    server.stop();
    callbackReject(new Error("Timed out waiting for browser authentication to complete."));
  }, timeoutMs);

  // Clean up timer when callback completes
  waitForCallback.finally(() => clearTimeout(timer));

  if (signal) {
    if (signal.aborted) {
      clearTimeout(timer);
      server.stop();
      callbackReject(signal.reason instanceof Error ? signal.reason : new Error("Aborted."));
    } else {
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        server.stop();
        callbackReject(signal.reason instanceof Error ? signal.reason : new Error("Aborted."));
      }, { once: true });
    }
  }

  const callbackUrl = `http://127.0.0.1:${server.port}/auth/callback`;
  return { callbackUrl, waitForCallback };
}

export async function loginWithPkce(options?: PkceLoginOptions): Promise<LoginResult> {
  const resolved = resolveOAuthOptions(options);
  const discovery = await discoverOAuth({ ...resolved, signal: options?.signal });
  const verifier = generateVerifier();
  const challenge = sha256(verifier);
  const state = generateState();
  const callbackServer = await startOAuthCallbackServer(options?.callbackPort, options?.timeoutMs, options?.signal);
  const authorizationUrl = new URL(discovery.authorizationEndpoint);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("client_id", resolved.clientId);
  authorizationUrl.searchParams.set("redirect_uri", callbackServer.callbackUrl);
  authorizationUrl.searchParams.set("scope", resolved.scopes.join(" "));
  authorizationUrl.searchParams.set("code_challenge", challenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  authorizationUrl.searchParams.set("state", state);
  if (resolved.audience) {
    authorizationUrl.searchParams.set("resource", resolved.audience);
  }

  options?.onAuthorizeUrl?.(authorizationUrl.toString());
  const openedBrowser = options?.openBrowser === false ? false : openBrowser(authorizationUrl.toString());
  const callback = await callbackServer.waitForCallback;
  if (callback.params.error) {
    throw new Error(`Browser authentication failed: ${callback.params.error_description ?? callback.params.error}`);
  }
  if (callback.params.state !== state) {
    throw new Error("Browser authentication failed: state verification mismatch.");
  }
  if (!callback.params.code) {
    throw new Error("Browser authentication failed: callback did not include an authorization code.");
  }

  const tokenPayload = (await postForm(discovery.tokenEndpoint, {
    grant_type: "authorization_code",
    client_id: resolved.clientId,
    code: callback.params.code,
    redirect_uri: callbackServer.callbackUrl,
    code_verifier: verifier,
    ...(resolved.audience ? { resource: resolved.audience } : {}),
  }, options?.signal)) as TokenResponse;

  const userInfo = await fetchUserInfo(discovery, tokenPayload.access_token, options?.signal);
  const authState = buildAuthState(tokenPayload, "pkce", resolved, discovery, userInfo);
  const storagePath = writeAuthState(authState);

  return {
    state: authState,
    storagePath,
    openedBrowser,
    authorizationUrl: authorizationUrl.toString(),
  };
}

export async function refreshAuthState(auth: AuthState, options?: RefreshOptions): Promise<AuthState> {
  if (!auth.refreshToken) {
    throw new Error("No refresh token is available for the current session.");
  }
  const resolved = resolveOAuthOptions({
    apiBaseUrl: options?.apiBaseUrl ?? auth.apiBaseUrl,
    issuerUrl: options?.issuerUrl ?? auth.issuerUrl,
    clientId: options?.clientId ?? auth.clientId,
    audience: options?.audience ?? auth.audience,
    scopes: options?.scopes ?? auth.scopes,
  });
  const discovery = await discoverOAuth({ ...resolved, signal: options?.signal });
  const tokenPayload = (await postForm(discovery.tokenEndpoint, {
    grant_type: "refresh_token",
    refresh_token: auth.refreshToken,
    client_id: resolved.clientId,
    ...(resolved.audience ? { resource: resolved.audience } : {}),
  }, options?.signal)) as TokenResponse;

  const userInfo = await fetchUserInfo(discovery, tokenPayload.access_token, options?.signal);
  const nextState = buildAuthState(
    {
      ...tokenPayload,
      refresh_token: tokenPayload.refresh_token ?? auth.refreshToken,
      scope: tokenPayload.scope ?? auth.scopes.join(" "),
      token_type: tokenPayload.token_type ?? auth.tokenType,
    },
    auth.method,
    resolved,
    discovery,
    userInfo ?? { sub: auth.user?.id, email: auth.user?.email, name: auth.user?.name },
  );
  writeAuthState(nextState);
  return nextState;
}

export async function ensureValidAuthState(auth: AuthState, options?: { signal?: AbortSignal }): Promise<AuthState> {
  if (!isExpired(auth)) return auth;
  if (!auth.refreshToken) return auth;
  try {
    return await refreshAuthState(auth, { signal: options?.signal });
  } catch {
    return auth;
  }
}

export async function revokeAuthState(auth: AuthState, options?: { signal?: AbortSignal }): Promise<void> {
  const discovery = await discoverOAuth({
    apiBaseUrl: auth.apiBaseUrl,
    issuerUrl: auth.issuerUrl,
    clientId: auth.clientId,
    audience: auth.audience,
    scopes: auth.scopes,
    signal: options?.signal,
  });
  if (!discovery.revocationEndpoint) return;
  try {
    await postForm(discovery.revocationEndpoint, {
      client_id: auth.clientId,
      token: auth.refreshToken ?? auth.accessToken,
    }, options?.signal);
  } catch {
    return;
  }
}
