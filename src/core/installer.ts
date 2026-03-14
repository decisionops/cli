import fs from "node:fs";
import path from "node:path";

import { inferDefaultBranch, inferRepoRef } from "./git.js";
import { writeAuthHandoff, writeManifest } from "./manifest.js";
import {
  authInstructions,
  contextForPaths,
  expandPath,
  type PlatformDefinition,
  resolveInstallPath,
  selectPlatforms,
  loadPlatforms,
} from "./platforms.js";
import {
  DEFAULT_MCP_SERVER_NAME,
  DEFAULT_MCP_SERVER_URL,
  DEFAULT_SKILL_NAME,
  PLACEHOLDER_ORG_ID,
  PLACEHOLDER_PROJECT_ID,
  PLACEHOLDER_REPO_REF,
} from "./config.js";

export type InstallOptions = {
  platformsDir: string;
  selectedPlatforms?: string[];
  skillName?: string;
  sourceDir?: string;
  outputDir?: string;
  repoPath?: string | null;
  orgId?: string;
  projectId?: string;
  repoRef?: string;
  repoId?: string;
  defaultBranch?: string;
  installSkill?: boolean;
  installMcp?: boolean;
  writeManifest?: boolean;
  allowPlaceholders?: boolean;
  serverName?: string;
  serverUrl?: string;
};

export type InstallResult = {
  builtPlatforms: string[];
  installedSkills: Array<{ platformId: string; target: string }>;
  installedMcp: Array<{ platformId: string; target: string }>;
  skippedMcp: Array<{ platformId: string; reason: string }>;
  manifestPath?: string;
  authHandoffPath?: string;
  placeholdersUsed: boolean;
};

export type BuildOptions = {
  platformsDir: string;
  selectedPlatforms?: string[];
  skillName?: string;
  sourceDir?: string;
  outputDir?: string;
  serverName?: string;
  serverUrl?: string;
};

export type CleanupOptions = {
  platformsDir: string;
  selectedPlatforms?: string[];
  skillName?: string;
  repoPath?: string | null;
  removeSkill?: boolean;
  removeMcp?: boolean;
  serverName?: string;
  removeManifest?: boolean;
  removeAuthHandoff?: boolean;
};

export type CleanupResult = {
  removedSkills: Array<{ platformId: string; target: string }>;
  skippedSkills: Array<{ platformId: string; reason: string }>;
  removedMcp: Array<{ platformId: string; target: string }>;
  skippedMcp: Array<{ platformId: string; reason: string }>;
  removedManifestPath?: string;
  removedAuthHandoffPath?: string;
};

function ensureSkillSource(sourceDir: string): void {
  if (!fs.existsSync(path.join(sourceDir, "SKILL.md"))) {
    throw new Error(`Skill source missing SKILL.md: ${sourceDir}`);
  }
}

function ensureDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function copyDir(sourceDir: string, targetDir: string): void {
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  fs.cpSync(sourceDir, targetDir, { recursive: true });
}

function renderMcpBuildContent(platform: PlatformDefinition, serverName: string, serverUrl: string): string {
  const mcp = platform.mcp;
  if (!mcp?.format) throw new Error(`Platform '${platform.id}' is missing MCP format`);
  if (mcp.format === "codex_toml") {
    return `[mcp_servers.${serverName}]\nenabled = true\nurl = "${serverUrl}"\n`;
  }
  if (mcp.format === "json_map") {
    return `${JSON.stringify({ [mcp.root_key ?? "mcpServers"]: { [serverName]: { type: "http", url: serverUrl } } }, null, 2)}\n`;
  }
  throw new Error(`Unsupported MCP format '${mcp.format}' for ${platform.id}`);
}

function upsertCodexToml(configPath: string, serverName: string, serverUrl: string): void {
  const sectionHeader = `[mcp_servers.${serverName}]`;
  const newBlock = [sectionHeader, "enabled = true", `url = "${serverUrl}"`];
  const lines = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8").split(/\r?\n/) : [];
  const output: string[] = [];
  let inserted = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === sectionHeader) {
      if (!inserted) { output.push(...newBlock); inserted = true; }
      index += 1;
      while (index < lines.length && !lines[index].startsWith("[")) { index += 1; }
      index -= 1;
      continue;
    }
    output.push(line);
  }

  if (!inserted) {
    if (output.length > 0 && output[output.length - 1] !== "") output.push("");
    output.push(...newBlock);
  }
  ensureDir(configPath);
  fs.writeFileSync(configPath, `${output.join("\n").replace(/\n+$/, "")}\n`, "utf8");
}

function upsertJsonMap(configPath: string, rootKey: string, serverName: string, serverUrl: string): void {
  const data = fs.existsSync(configPath) && fs.readFileSync(configPath, "utf8").trim().length > 0
    ? JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>
    : {};
  const root = (data[rootKey] as Record<string, unknown> | undefined) ?? {};
  root[serverName] = { type: "http", url: serverUrl };
  data[rootKey] = root;
  ensureDir(configPath);
  fs.writeFileSync(configPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function removeCodexTomlServer(configPath: string, serverName: string): boolean {
  if (!fs.existsSync(configPath)) return false;
  const sectionHeader = new RegExp(`^\\[mcp_servers\\.${escapeRegExp(serverName)}\\]\\s*$`);
  const lines = fs.readFileSync(configPath, "utf8").split(/\r?\n/);
  const output: string[] = [];
  let removed = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (sectionHeader.test(line.trim())) {
      removed = true;
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("[")) { index += 1; }
      index -= 1;
      continue;
    }
    output.push(line);
  }
  if (!removed) return false;
  const normalized = output.join("\n").replace(/\n+$/, "");
  if (normalized.trim().length === 0) { fs.rmSync(configPath, { force: true }); return true; }
  ensureDir(configPath);
  fs.writeFileSync(configPath, `${normalized}\n`, "utf8");
  return true;
}

function removeJsonMapServer(configPath: string, rootKey: string, serverName: string): boolean {
  if (!fs.existsSync(configPath)) return false;
  const raw = fs.readFileSync(configPath, "utf8").trim();
  if (!raw) return false;
  const data = JSON.parse(raw) as Record<string, unknown>;
  const root = data[rootKey];
  if (!root || typeof root !== "object" || Array.isArray(root)) return false;
  const rootMap = root as Record<string, unknown>;
  if (!(serverName in rootMap)) return false;
  delete rootMap[serverName];
  if (Object.keys(rootMap).length === 0) { delete data[rootKey]; } else { data[rootKey] = rootMap; }
  if (Object.keys(data).length === 0) { fs.rmSync(configPath, { force: true }); return true; }
  ensureDir(configPath);
  fs.writeFileSync(configPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return true;
}

function removeFileIfPresent(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  fs.rmSync(filePath, { force: true });
  return true;
}

function removeEmptyDirIfPresent(dirPath: string): void {
  if (!fs.existsSync(dirPath)) return;
  if (!fs.statSync(dirPath).isDirectory()) return;
  if (fs.readdirSync(dirPath).length > 0) return;
  fs.rmSync(dirPath, { recursive: true, force: true });
}

export function buildPlatform(platform: PlatformDefinition, skillName: string, sourceDir: string, outputDir: string, serverName: string, serverUrl: string): string {
  const platformOutput = path.join(outputDir, platform.id);
  fs.rmSync(platformOutput, { recursive: true, force: true });
  const context = contextForPaths(skillName, null);

  if (platform.skill?.supported && platform.skill.build_path) {
    const skillBuildPath = expandPath(platform.skill.build_path, context);
    copyDir(sourceDir, path.join(platformOutput, skillBuildPath));
  }
  if (platform.mcp?.supported && platform.mcp.build_path) {
    const mcpBuildPath = expandPath(platform.mcp.build_path, context);
    const targetPath = path.join(platformOutput, mcpBuildPath);
    ensureDir(targetPath);
    fs.writeFileSync(targetPath, renderMcpBuildContent(platform, serverName, serverUrl), "utf8");
  }
  if (platform.manifest?.supported && platform.manifest.build_path) {
    const manifestBuildPath = expandPath(platform.manifest.build_path, context);
    const targetPath = path.join(platformOutput, manifestBuildPath);
    ensureDir(targetPath);
    fs.writeFileSync(
      targetPath,
      `version = 1\norg_id = "${PLACEHOLDER_ORG_ID}"\nproject_id = "${PLACEHOLDER_PROJECT_ID}"\nrepo_ref = "${PLACEHOLDER_REPO_REF}"\ndefault_branch = "main"\nmcp_server_name = "${serverName}"\nmcp_server_url = "${serverUrl}"\n`,
      "utf8",
    );
  }
  return platformOutput;
}

export function buildPlatforms(options: BuildOptions): Array<{ platformId: string; outputPath: string }> {
  const platforms = loadPlatforms(options.platformsDir);
  const selected = selectPlatforms(platforms, options.selectedPlatforms);
  const skillName = options.skillName ?? DEFAULT_SKILL_NAME;
  const sourceDir = options.sourceDir ?? "";
  const outputDir = options.outputDir ?? "";
  const serverName = options.serverName ?? DEFAULT_MCP_SERVER_NAME;
  const serverUrl = options.serverUrl ?? DEFAULT_MCP_SERVER_URL;
  if (sourceDir) ensureSkillSource(sourceDir);
  return selected.map((platform) => ({
    platformId: platform.id,
    outputPath: buildPlatform(platform, skillName, sourceDir, outputDir, serverName, serverUrl),
  }));
}

export function installPlatforms(options: InstallOptions): InstallResult {
  const platforms = loadPlatforms(options.platformsDir);
  const selected = selectPlatforms(platforms, options.selectedPlatforms);
  const skillName = options.skillName ?? DEFAULT_SKILL_NAME;
  const sourceDir = options.sourceDir ?? "";
  const outputDir = options.outputDir ?? "";
  const serverName = options.serverName ?? DEFAULT_MCP_SERVER_NAME;
  const serverUrl = options.serverUrl ?? DEFAULT_MCP_SERVER_URL;
  const repoPath = options.repoPath ?? null;
  const installSkill = options.installSkill ?? true;
  const installMcp = options.installMcp ?? true;
  const shouldWriteManifest = options.writeManifest ?? true;
  const allowPlaceholders = options.allowPlaceholders ?? false;

  if (sourceDir) ensureSkillSource(sourceDir);
  if (!sourceDir && installSkill && selected.some((platform) => platform.skill?.supported)) {
    throw new Error("Skill source is required to install skill files. Pass --source-dir or use --skip-skill.");
  }

  const repoRequired = shouldWriteManifest || (installMcp && selected.some((p) => p.mcp?.supported && p.mcp.scope === "project"));
  if (repoRequired && !repoPath) {
    throw new Error("--repo-path is required for manifest writes or project-scoped MCP config.");
  }

  const result: InstallResult = {
    builtPlatforms: [],
    installedSkills: [],
    installedMcp: [],
    skippedMcp: [],
    placeholdersUsed: false,
  };

  if (shouldWriteManifest && repoPath) {
    const orgId = options.orgId ?? (() => {
      if (allowPlaceholders) { result.placeholdersUsed = true; return PLACEHOLDER_ORG_ID; }
      throw new Error("--org-id is required when writing a manifest.");
    })();
    const projectId = options.projectId ?? (() => {
      if (allowPlaceholders) { result.placeholdersUsed = true; return PLACEHOLDER_PROJECT_ID; }
      throw new Error("--project-id is required when writing a manifest.");
    })();
    const repoRef = options.repoRef ?? (() => {
      try { return inferRepoRef(repoPath); } catch {
        if (allowPlaceholders) { result.placeholdersUsed = true; return PLACEHOLDER_REPO_REF; }
        throw new Error("Could not infer repo_ref from git remote.");
      }
    })();
    const defaultBranch = options.defaultBranch ?? inferDefaultBranch(repoPath);
    result.manifestPath = writeManifest(repoPath, {
      org_id: orgId, project_id: projectId, repo_ref: repoRef,
      default_branch: defaultBranch, mcp_server_name: serverName, mcp_server_url: serverUrl,
      repo_id: options.repoId,
    });
  }

  if (sourceDir && outputDir) {
    for (const entry of buildPlatforms({
      platformsDir: options.platformsDir, selectedPlatforms: options.selectedPlatforms,
      skillName, sourceDir, outputDir, serverName, serverUrl,
    })) {
      result.builtPlatforms.push(entry.platformId);
    }
  }

  const authHandoffEntries = [];
  for (const platform of selected) {
    const context = contextForPaths(skillName, repoPath);

    if (installSkill && platform.skill?.supported && sourceDir) {
      const target = resolveInstallPath(platform.skill, context);
      if (!target) throw new Error(`Could not determine skill install path for ${platform.id}`);
      if (outputDir) {
        const relativePath = expandPath(platform.skill.build_path!, contextForPaths(skillName, null));
        const bundle = path.join(outputDir, platform.id, relativePath);
        copyDir(bundle, target);
      } else {
        copyDir(sourceDir, target);
      }
      result.installedSkills.push({ platformId: platform.id, target });
    }

    if (installMcp && platform.mcp?.supported) {
      const target = resolveInstallPath(platform.mcp, context);
      if (!target) { result.skippedMcp.push({ platformId: platform.id, reason: "no target path configured" }); continue; }
      if (platform.mcp.format === "codex_toml") { upsertCodexToml(target, serverName, serverUrl); }
      else if (platform.mcp.format === "json_map") { upsertJsonMap(target, platform.mcp.root_key ?? "mcpServers", serverName, serverUrl); }
      else { throw new Error(`Unsupported MCP format '${platform.mcp.format}' for ${platform.id}`); }
      result.installedMcp.push({ platformId: platform.id, target });

      const instructions = authInstructions(platform, {
        ...context, platform_id: platform.id, display_name: platform.display_name,
        mcp_server_name: serverName, mcp_server_url: serverUrl, mcp_config_path: target,
      });
      if (instructions) {
        authHandoffEntries.push({
          id: platform.id, display_name: platform.display_name,
          mode: platform.auth?.mode ?? "interactive_handoff",
          platform_definition: platform.__file__, mcp_config_path: target, instructions,
        });
      }
    }
  }

  if (authHandoffEntries.length > 0) {
    result.authHandoffPath = writeAuthHandoff(repoPath, outputDir, authHandoffEntries);
  }
  return result;
}

export function cleanupPlatforms(options: CleanupOptions): CleanupResult {
  const platforms = loadPlatforms(options.platformsDir);
  const selected = selectPlatforms(platforms, options.selectedPlatforms);
  const skillName = options.skillName ?? DEFAULT_SKILL_NAME;
  const repoPath = options.repoPath ?? null;
  const removeSkill = options.removeSkill ?? true;
  const removeMcp = options.removeMcp ?? true;
  const serverName = options.serverName ?? DEFAULT_MCP_SERVER_NAME;

  const result: CleanupResult = {
    removedSkills: [], skippedSkills: [], removedMcp: [], skippedMcp: [],
  };

  for (const platform of selected) {
    const context = contextForPaths(skillName, repoPath);
    if (removeSkill && platform.skill?.supported) {
      const target = resolveInstallPath(platform.skill, context);
      if (!target) { result.skippedSkills.push({ platformId: platform.id, reason: "no target path configured" }); }
      else if (!fs.existsSync(target)) { result.skippedSkills.push({ platformId: platform.id, reason: `skill path does not exist (${target})` }); }
      else { fs.rmSync(target, { recursive: true, force: true }); result.removedSkills.push({ platformId: platform.id, target }); }
    }
    if (removeMcp && platform.mcp?.supported) {
      const target = resolveInstallPath(platform.mcp, context);
      if (!target) { result.skippedMcp.push({ platformId: platform.id, reason: "no target path configured" }); continue; }
      try {
        let removed = false;
        if (platform.mcp.format === "codex_toml") { removed = removeCodexTomlServer(target, serverName); }
        else if (platform.mcp.format === "json_map") { removed = removeJsonMapServer(target, platform.mcp.root_key ?? "mcpServers", serverName); }
        else { result.skippedMcp.push({ platformId: platform.id, reason: `unsupported MCP format '${platform.mcp.format}'` }); continue; }
        if (removed) { result.removedMcp.push({ platformId: platform.id, target }); }
        else if (!fs.existsSync(target)) { result.skippedMcp.push({ platformId: platform.id, reason: `config path does not exist (${target})` }); }
        else { result.skippedMcp.push({ platformId: platform.id, reason: `server '${serverName}' not found` }); }
      } catch (error) {
        result.skippedMcp.push({ platformId: platform.id, reason: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  if (repoPath && (options.removeManifest ?? false)) {
    const manifestPath = path.join(repoPath, ".decisionops", "manifest.toml");
    if (removeFileIfPresent(manifestPath)) result.removedManifestPath = manifestPath;
  }
  if (repoPath && (options.removeAuthHandoff ?? false)) {
    const authHandoffPath = path.join(repoPath, ".decisionops", "auth-handoff.toml");
    if (removeFileIfPresent(authHandoffPath)) result.removedAuthHandoffPath = authHandoffPath;
  }
  if (repoPath) removeEmptyDirIfPresent(path.join(repoPath, ".decisionops"));
  return result;
}
