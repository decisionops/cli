import fs from "node:fs";
import path from "node:path";
import * as TOML from "@iarna/toml";
import { expandHome } from "./config.js";

export type PlatformInstallSpec = {
  supported?: boolean;
  build_path?: string;
  install_path_env?: string;
  install_path_default?: string;
  install_root_env?: string;
  install_root_default?: string;
  install_path_suffix?: string;
  scope?: "user" | "project";
  format?: "codex_toml" | "json_map";
  root_key?: string;
};

export type PlatformAuthSpec = {
  mode?: string;
  instructions?: string[];
};

export type PlatformDefinition = {
  id: string;
  display_name: string;
  skill?: PlatformInstallSpec;
  mcp?: PlatformInstallSpec;
  manifest?: PlatformInstallSpec;
  auth?: PlatformAuthSpec;
  __file__: string;
};

export function formatTemplate(template: string, context: Record<string, string>): string {
  return template.replace(/\{([^}]+)\}/g, (match, key: string) => {
    if (!(key in context)) throw new Error(`Missing template variable '${key}' in value: ${template}`);
    return context[key] ?? match;
  });
}

export function expandPath(value: string, context: Record<string, string>): string {
  return expandHome(formatTemplate(value, context));
}

export function contextForPaths(skillName: string, repoPath: string | null): Record<string, string> {
  return { skill_name: skillName, repo_path: repoPath ?? "" };
}

export function loadPlatforms(platformsDir: string): Record<string, PlatformDefinition> {
  const platforms: Record<string, PlatformDefinition> = {};
  for (const entry of fs.readdirSync(platformsDir)) {
    if (!entry.endsWith(".toml")) continue;
    const filePath = path.join(platformsDir, entry);
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = TOML.parse(raw) as Omit<PlatformDefinition, "__file__">;
    if (!parsed.id) throw new Error(`Platform file missing id: ${filePath}`);
    if (parsed.id !== path.basename(entry, ".toml")) {
      throw new Error(`Platform id '${parsed.id}' must match filename: ${filePath}`);
    }
    platforms[parsed.id] = { ...parsed, __file__: filePath };
  }
  if (Object.keys(platforms).length === 0) {
    throw new Error(`No platform definitions found in ${platformsDir}`);
  }
  return platforms;
}

export function selectPlatforms(
  platforms: Record<string, PlatformDefinition>,
  selectedIds?: string[],
  capability?: "skill" | "mcp" | "manifest",
): PlatformDefinition[] {
  const orderedIds = selectedIds && selectedIds.length > 0 ? selectedIds : Object.keys(platforms);
  const missing = orderedIds.filter((id) => !platforms[id]);
  if (missing.length > 0) throw new Error(`Unknown platform(s): ${missing.join(", ")}`);
  return orderedIds
    .map((id) => platforms[id])
    .filter((p) => !capability || Boolean(p[capability]?.supported));
}

export function resolveInstallPath(spec: PlatformInstallSpec, context: Record<string, string>): string | null {
  if (spec.install_path_env && process.env[spec.install_path_env]) {
    return path.resolve(expandPath(process.env[spec.install_path_env]!, context));
  }
  if (spec.install_root_env || spec.install_root_default) {
    const rootValue = spec.install_root_env ? process.env[spec.install_root_env] || spec.install_root_default : spec.install_root_default;
    if (!rootValue) return null;
    const rootPath = path.resolve(expandPath(rootValue, context));
    return path.join(rootPath, formatTemplate(spec.install_path_suffix ?? "", context));
  }
  if (spec.install_path_default) {
    if (!context.repo_path && spec.install_path_default.includes("{repo_path}")) return null;
    return path.resolve(expandPath(spec.install_path_default, context));
  }
  return null;
}

export function authInstructions(platform: PlatformDefinition, context: Record<string, string>): string[] | null {
  if (platform.auth?.mode !== "interactive_handoff") return null;
  return (platform.auth.instructions ?? []).map((step) => formatTemplate(step, context));
}
