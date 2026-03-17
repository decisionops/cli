import path from "node:path";

export const DEFAULT_SKILL_NAME = process.env.SKILL_NAME ?? "decision-ops";
export const DEFAULT_MCP_SERVER_NAME = process.env.MCP_SERVER_NAME ?? "decision-ops-mcp";
export const DEFAULT_MCP_SERVER_URL = process.env.MCP_SERVER_URL ?? "https://api.aidecisionops.com/mcp";
export const DEFAULT_API_BASE_URL = process.env.DECISIONOPS_API_BASE_URL ?? "https://api.aidecisionops.com";
export const DEFAULT_OAUTH_ISSUER_URL = "https://auth.aidecisionops.com/oauth";
export const DEFAULT_OAUTH_CLIENT_ID = "decisionops-cli";
export const DEFAULT_OAUTH_SCOPES = ["decisions:read", "decisions:write", "decisions:approve", "metrics:read", "admin:read"];
export const DEFAULT_OAUTH_API_AUDIENCE = "https://api.aidecisionops.com/v1";
export const PLACEHOLDER_ORG_ID = "org_123";
export const PLACEHOLDER_PROJECT_ID = "proj_456";
export const PLACEHOLDER_REPO_REF = "owner/repo";

export function expandHome(input: string): string {
  if (!input.startsWith("~")) return input;
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (!home) return input;
  if (input === "~") return home;
  if (input.startsWith("~/") || input.startsWith("~\\")) return path.join(home, input.slice(2));
  return input;
}

export function decisionopsHome(): string {
  return expandHome(process.env.DECISIONOPS_HOME ?? "~/.decisionops");
}
