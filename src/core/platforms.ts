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

function normalizePlatformId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0]!;
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const nextDiagonal = previous[j]!;
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      previous[j] = Math.min(
        previous[j]! + 1,
        previous[j - 1]! + 1,
        diagonal + substitutionCost,
      );
      diagonal = nextDiagonal;
    }
  }

  return previous[b.length]!;
}

function suggestPlatformId(platformIds: string[], input: string): string | null {
  const normalizedInput = normalizePlatformId(input);
  if (!normalizedInput) return null;

  let bestPrefixMatch: string | null = null;
  let bestDistanceMatch: { id: string; distance: number } | null = null;

  for (const platformId of platformIds) {
    const normalizedPlatformId = normalizePlatformId(platformId);
    if (
      normalizedPlatformId.startsWith(normalizedInput) ||
      normalizedInput.startsWith(normalizedPlatformId) ||
      normalizedPlatformId.includes(normalizedInput)
    ) {
      if (!bestPrefixMatch || platformId.length < bestPrefixMatch.length) bestPrefixMatch = platformId;
      continue;
    }

    const distance = levenshteinDistance(normalizedInput, normalizedPlatformId);
    if (!bestDistanceMatch || distance < bestDistanceMatch.distance) {
      bestDistanceMatch = { id: platformId, distance };
    }
  }

  if (bestPrefixMatch) return bestPrefixMatch;
  if (!bestDistanceMatch) return null;

  const maxDistance = normalizedInput.length <= 4 ? 1 : 2;
  return bestDistanceMatch.distance <= maxDistance ? bestDistanceMatch.id : null;
}

function unknownPlatformsMessage(platformIds: string[], missing: string[]): string {
  const base = `Unknown platform(s): ${missing.join(", ")}.`;
  if (missing.length === 1) {
    const suggestion = suggestPlatformId(platformIds, missing[0]!);
    if (suggestion) return `${base} Did you mean '${suggestion}'? Run 'dops platform list' for supported platforms.`;
    return `${base} Run 'dops platform list' for supported platforms.`;
  }

  const suggestions = missing
    .map((id) => {
      const suggestion = suggestPlatformId(platformIds, id);
      return suggestion ? `'${id}' -> '${suggestion}'` : null;
    })
    .filter((value): value is string => Boolean(value));

  if (suggestions.length > 0) {
    return `${base} Suggestions: ${suggestions.join(", ")}. Run 'dops platform list' for supported platforms.`;
  }

  return `${base} Run 'dops platform list' for supported platforms.`;
}

export function selectPlatforms(
  platforms: Record<string, PlatformDefinition>,
  selectedIds?: string[],
  capability?: "skill" | "mcp" | "manifest",
): PlatformDefinition[] {
  const orderedIds = selectedIds && selectedIds.length > 0 ? selectedIds : Object.keys(platforms);
  const missing = orderedIds.filter((id) => !platforms[id]);
  if (missing.length > 0) throw new Error(unknownPlatformsMessage(Object.keys(platforms), missing));
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
