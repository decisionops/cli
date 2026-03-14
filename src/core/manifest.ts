import fs from "node:fs";
import path from "node:path";
import * as TOML from "@iarna/toml";

export type ManifestValues = {
  org_id: string;
  project_id: string;
  repo_ref: string;
  default_branch: string;
  mcp_server_name: string;
  mcp_server_url: string;
  repo_id?: string;
};

export type AuthHandoffEntry = {
  id: string;
  display_name: string;
  mode: string;
  platform_definition: string;
  mcp_config_path: string;
  instructions: string[];
};

export function writeManifest(repoPath: string, values: ManifestValues): string {
  const filePath = path.join(repoPath, ".decisionops", "manifest.toml");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    TOML.stringify({
      version: 1,
      org_id: values.org_id,
      project_id: values.project_id,
      repo_ref: values.repo_ref,
      ...(values.repo_id ? { repo_id: values.repo_id } : {}),
      default_branch: values.default_branch,
      mcp_server_name: values.mcp_server_name,
      mcp_server_url: values.mcp_server_url,
    }),
    "utf8",
  );
  return filePath;
}

export function readManifest(repoPath: string): Record<string, unknown> | null {
  const filePath = path.join(repoPath, ".decisionops", "manifest.toml");
  if (!fs.existsSync(filePath)) return null;
  return TOML.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
}

export function writeAuthHandoff(repoPath: string | null, outputDir: string, entries: AuthHandoffEntry[]): string {
  const filePath = repoPath
    ? path.join(repoPath, ".decisionops", "auth-handoff.toml")
    : path.join(outputDir, "auth-handoff.toml");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, TOML.stringify({ version: 1, platforms: entries }), "utf8");
  return filePath;
}
