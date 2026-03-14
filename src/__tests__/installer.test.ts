import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildPlatform, installPlatforms, cleanupPlatforms } from "../core/installer.js";
import type { PlatformDefinition } from "../core/platforms.js";

/**
 * Helper: write a platform TOML file into a directory.
 */
function writePlatformToml(dir: string, id: string, toml: string): string {
  const filePath = path.join(dir, `${id}.toml`);
  fs.writeFileSync(filePath, toml, "utf8");
  return filePath;
}

/**
 * Helper: create a minimal skill source directory with SKILL.md.
 */
function createSkillSource(baseDir: string): string {
  const sourceDir = path.join(baseDir, "skill-source");
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, "SKILL.md"), "# Test Skill\nThis is a test.", "utf8");
  fs.writeFileSync(path.join(sourceDir, "helper.md"), "Helper content", "utf8");
  return sourceDir;
}

describe("installer", () => {
  let tmpDir: string;
  let platformsDir: string;
  let outputDir: string;
  let repoDir: string;

  const originalHome = process.env.HOME;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dops-installer-test-"));
    platformsDir = path.join(tmpDir, "platforms");
    outputDir = path.join(tmpDir, "output");
    repoDir = path.join(tmpDir, "repo");
    fs.mkdirSync(platformsDir, { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(repoDir, { recursive: true });
    process.env.HOME = tmpDir;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (originalHome !== undefined) process.env.HOME = originalHome;
    else delete process.env.HOME;
  });

  // -- Platform TOML templates --

  // Note: We avoid {repo_path} in the default jsonMapPlatformToml because it
  // requires an actual repo path at install time. We only include skill with
  // user-scope for the basic MCP tests; skill-copy tests define their own TOML.
  const jsonMapPlatformToml = [
    'id = "json-platform"',
    'display_name = "JSON Platform"',
    '',
    '[mcp]',
    'supported = true',
    'build_path = ".json-platform/mcp.json"',
    'format = "json_map"',
    'root_key = "mcpServers"',
    'install_path_default = "~/.json-platform/mcp.json"',
    'scope = "user"',
  ].join('\n') + '\n';

  const codexTomlPlatformToml = [
    'id = "codex-platform"',
    'display_name = "Codex Platform"',
    '',
    '[mcp]',
    'supported = true',
    'build_path = ".codex-platform/codex.toml"',
    'format = "codex_toml"',
    'install_path_default = "~/.codex-platform/codex.toml"',
    'scope = "user"',
  ].join('\n') + '\n';

  const manifestPlatformToml = [
    'id = "manifest-platform"',
    'display_name = "Manifest Platform"',
    '',
    '[manifest]',
    'supported = true',
    'build_path = ".decisionops/manifest.toml"',
    '',
    '[mcp]',
    'supported = true',
    'build_path = ".manifest-platform/mcp.json"',
    'format = "json_map"',
    'root_key = "mcpServers"',
    'install_path_default = "~/.manifest-platform/mcp.json"',
    'scope = "user"',
  ].join('\n') + '\n';

  const authPlatformToml = [
    'id = "auth-platform"',
    'display_name = "Auth Platform"',
    '',
    '[mcp]',
    'supported = true',
    'build_path = ".auth-platform/mcp.json"',
    'format = "json_map"',
    'root_key = "mcpServers"',
    'install_path_default = "~/.auth-platform/config.json"',
    'scope = "user"',
    '',
    '[auth]',
    'mode = "interactive_handoff"',
    'instructions = [',
    '  "Open {mcp_config_path}",',
    '  "Add your token for {display_name}",',
    ']',
  ].join('\n') + '\n';

  // ============================================================
  // buildPlatform
  // ============================================================
  describe("buildPlatform", () => {
    it("builds skill files into output directory", () => {
      const sourceDir = createSkillSource(tmpDir);
      writePlatformToml(platformsDir, "json-platform", jsonMapPlatformToml);

      const platform: PlatformDefinition = {
        id: "json-platform",
        display_name: "JSON Platform",
        __file__: path.join(platformsDir, "json-platform.toml"),
        skill: {
          supported: true,
          build_path: ".{skill_name}/skills/{skill_name}",
        },
        mcp: {
          supported: true,
          build_path: ".json-platform/mcp.json",
          format: "json_map",
          root_key: "mcpServers",
        },
      };

      const result = buildPlatform(platform, "decision-ops", sourceDir, outputDir, "dops-mcp", "https://api.test.com/mcp");
      expect(fs.existsSync(result)).toBe(true);

      // Skill files should be copied
      const skillDir = path.join(result, ".decision-ops/skills/decision-ops");
      expect(fs.existsSync(path.join(skillDir, "SKILL.md"))).toBe(true);
      expect(fs.existsSync(path.join(skillDir, "helper.md"))).toBe(true);

      // MCP config should be built
      const mcpPath = path.join(result, ".json-platform/mcp.json");
      expect(fs.existsSync(mcpPath)).toBe(true);
      const mcpContent = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
      expect(mcpContent.mcpServers["dops-mcp"]).toEqual({
        type: "http",
        url: "https://api.test.com/mcp",
      });
    });

    it("builds codex_toml format MCP config", () => {
      const sourceDir = createSkillSource(tmpDir);
      const platform: PlatformDefinition = {
        id: "codex-platform",
        display_name: "Codex Platform",
        __file__: "fake.toml",
        mcp: {
          supported: true,
          build_path: ".codex-platform/codex.toml",
          format: "codex_toml",
        },
      };

      const result = buildPlatform(platform, "decision-ops", sourceDir, outputDir, "dops-mcp", "https://mcp.test.com");
      const tomlPath = path.join(result, ".codex-platform/codex.toml");
      expect(fs.existsSync(tomlPath)).toBe(true);
      const content = fs.readFileSync(tomlPath, "utf8");
      expect(content).toContain("[mcp_servers.dops-mcp]");
      expect(content).toContain("enabled = true");
      expect(content).toContain('url = "https://mcp.test.com"');
    });

    it("builds manifest template with placeholders", () => {
      const sourceDir = createSkillSource(tmpDir);
      const platform: PlatformDefinition = {
        id: "manifest-platform",
        display_name: "Manifest Platform",
        __file__: "fake.toml",
        manifest: {
          supported: true,
          build_path: ".decisionops/manifest.toml",
        },
      };

      const result = buildPlatform(platform, "decision-ops", sourceDir, outputDir, "dops-mcp", "https://mcp.test.com");
      const manifestPath = path.join(result, ".decisionops/manifest.toml");
      expect(fs.existsSync(manifestPath)).toBe(true);
      const content = fs.readFileSync(manifestPath, "utf8");
      expect(content).toContain("version = 1");
      expect(content).toContain("org_123");
      expect(content).toContain("proj_456");
    });
  });

  // ============================================================
  // installPlatforms - MCP upsert json_map
  // ============================================================
  describe("installPlatforms - json_map MCP upsert", () => {
    it("creates a new JSON MCP config file", () => {
      writePlatformToml(platformsDir, "json-platform", jsonMapPlatformToml);
      const sourceDir = createSkillSource(tmpDir);

      const result = installPlatforms({
        platformsDir,
        repoPath: repoDir,
        sourceDir,
        outputDir,
        orgId: "org_1",
        projectId: "proj_1",
        repoRef: "owner/repo",
        defaultBranch: "main",
        installSkill: false,
        installMcp: true,
        writeManifest: false,
      });

      expect(result.installedMcp.length).toBe(1);
      const target = result.installedMcp[0].target;
      expect(fs.existsSync(target)).toBe(true);
      const content = JSON.parse(fs.readFileSync(target, "utf8"));
      expect(content.mcpServers["decision-ops-mcp"]).toBeDefined();
      expect(content.mcpServers["decision-ops-mcp"].url).toBe("https://api.aidecisionops.com/mcp");
    });

    it("upserts into an existing JSON MCP config preserving other entries", () => {
      writePlatformToml(platformsDir, "json-platform", jsonMapPlatformToml);
      const targetPath = path.join(tmpDir, ".json-platform", "mcp.json");
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(
        targetPath,
        JSON.stringify({ mcpServers: { "other-server": { type: "http", url: "https://other.com" } } }, null, 2),
        "utf8",
      );

      // Override the install_path_default to use our known path
      const customToml = jsonMapPlatformToml.replace(
        'install_path_default = "~/.json-platform/mcp.json"',
        `install_path_default = "${targetPath}"`,
      );
      writePlatformToml(platformsDir, "json-platform", customToml);

      installPlatforms({
        platformsDir,
        repoPath: repoDir,
        installSkill: false,
        installMcp: true,
        writeManifest: false,
      });

      const content = JSON.parse(fs.readFileSync(targetPath, "utf8"));
      expect(content.mcpServers["other-server"]).toBeDefined();
      expect(content.mcpServers["decision-ops-mcp"]).toBeDefined();
    });
  });

  // ============================================================
  // installPlatforms - MCP upsert codex_toml
  // ============================================================
  describe("installPlatforms - codex_toml MCP upsert", () => {
    it("creates a new codex TOML config file", () => {
      writePlatformToml(platformsDir, "codex-platform", codexTomlPlatformToml);

      const result = installPlatforms({
        platformsDir,
        repoPath: repoDir,
        installSkill: false,
        installMcp: true,
        writeManifest: false,
      });

      expect(result.installedMcp.length).toBe(1);
      const target = result.installedMcp[0].target;
      expect(fs.existsSync(target)).toBe(true);
      const content = fs.readFileSync(target, "utf8");
      expect(content).toContain("[mcp_servers.decision-ops-mcp]");
      expect(content).toContain("enabled = true");
    });

    it("upserts into an existing codex TOML preserving other sections", () => {
      const targetPath = path.join(tmpDir, ".codex-platform", "codex.toml");
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(
        targetPath,
        '[mcp_servers.other-server]\nenabled = true\nurl = "https://other.com"\n',
        "utf8",
      );

      const customToml = codexTomlPlatformToml.replace(
        'install_path_default = "~/.codex-platform/codex.toml"',
        `install_path_default = "${targetPath}"`,
      );
      writePlatformToml(platformsDir, "codex-platform", customToml);

      installPlatforms({
        platformsDir,
        repoPath: repoDir,
        installSkill: false,
        installMcp: true,
        writeManifest: false,
      });

      const content = fs.readFileSync(targetPath, "utf8");
      expect(content).toContain("[mcp_servers.other-server]");
      expect(content).toContain("[mcp_servers.decision-ops-mcp]");
    });

    it("replaces existing server entry in codex TOML", () => {
      const targetPath = path.join(tmpDir, ".codex-platform", "codex.toml");
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(
        targetPath,
        '[mcp_servers.decision-ops-mcp]\nenabled = false\nurl = "https://old.com"\n',
        "utf8",
      );

      const customToml = codexTomlPlatformToml.replace(
        'install_path_default = "~/.codex-platform/codex.toml"',
        `install_path_default = "${targetPath}"`,
      );
      writePlatformToml(platformsDir, "codex-platform", customToml);

      installPlatforms({
        platformsDir,
        repoPath: repoDir,
        installSkill: false,
        installMcp: true,
        writeManifest: false,
        serverUrl: "https://new-api.com/mcp",
      });

      const content = fs.readFileSync(targetPath, "utf8");
      expect(content).toContain("[mcp_servers.decision-ops-mcp]");
      expect(content).toContain("enabled = true");
      expect(content).toContain('url = "https://new-api.com/mcp"');
      expect(content).not.toContain("https://old.com");
    });
  });

  // ============================================================
  // installPlatforms - skill copy
  // ============================================================
  describe("installPlatforms - skill copy", () => {
    it("copies skill source to the resolved install path", () => {
      const sourceDir = createSkillSource(tmpDir);
      const skillTarget = path.join(repoDir, ".json-platform", "skills", "decision-ops");

      // Use a platform that installs skills into repo_path
      const customToml = `
id = "json-platform"
display_name = "JSON Platform"

[skill]
supported = true
build_path = ".decision-ops/skills/{skill_name}"
install_path_default = "{repo_path}/.json-platform/skills/{skill_name}"
scope = "project"

[mcp]
supported = true
build_path = ".json-platform/mcp.json"
format = "json_map"
root_key = "mcpServers"
install_path_default = "~/.json-platform/mcp.json"
scope = "user"
`;
      writePlatformToml(platformsDir, "json-platform", customToml);

      const result = installPlatforms({
        platformsDir,
        repoPath: repoDir,
        sourceDir,
        outputDir,
        orgId: "org_1",
        projectId: "proj_1",
        repoRef: "owner/repo",
        defaultBranch: "main",
        installSkill: true,
        installMcp: false,
        writeManifest: false,
      });

      expect(result.installedSkills.length).toBe(1);
      expect(fs.existsSync(path.join(skillTarget, "SKILL.md"))).toBe(true);
      expect(fs.existsSync(path.join(skillTarget, "helper.md"))).toBe(true);
    });

    it("copies skill source directly when outputDir is not provided", () => {
      const sourceDir = createSkillSource(tmpDir);
      const skillTarget = path.join(repoDir, ".json-platform", "skills", "decision-ops");

      const customToml = `
id = "json-platform"
display_name = "JSON Platform"

[skill]
supported = true
build_path = ".decision-ops/skills/{skill_name}"
install_path_default = "{repo_path}/.json-platform/skills/{skill_name}"
scope = "project"
`;
      writePlatformToml(platformsDir, "json-platform", customToml);

      const result = installPlatforms({
        platformsDir,
        repoPath: repoDir,
        sourceDir,
        installSkill: true,
        installMcp: false,
        writeManifest: false,
      });

      expect(result.installedSkills).toEqual([{ platformId: "json-platform", target: skillTarget }]);
      expect(fs.existsSync(path.join(skillTarget, "SKILL.md"))).toBe(true);
      expect(fs.existsSync(path.join(skillTarget, "helper.md"))).toBe(true);
    });
  });

  // ============================================================
  // installPlatforms - manifest writing
  // ============================================================
  describe("installPlatforms - manifest", () => {
    it("writes manifest with provided values", () => {
      writePlatformToml(platformsDir, "json-platform", jsonMapPlatformToml);

      const result = installPlatforms({
        platformsDir,
        repoPath: repoDir,
        orgId: "org_real",
        projectId: "proj_real",
        repoRef: "myorg/myrepo",
        defaultBranch: "develop",
        installSkill: false,
        installMcp: false,
        writeManifest: true,
      });

      expect(result.manifestPath).toBeDefined();
      expect(fs.existsSync(result.manifestPath!)).toBe(true);
      const content = fs.readFileSync(result.manifestPath!, "utf8");
      expect(content).toContain('org_id = "org_real"');
      expect(content).toContain('project_id = "proj_real"');
      expect(content).toContain('repo_ref = "myorg/myrepo"');
      expect(content).toContain('default_branch = "develop"');
    });

    it("uses placeholders when allowPlaceholders is true and values missing", () => {
      writePlatformToml(platformsDir, "json-platform", jsonMapPlatformToml);

      const result = installPlatforms({
        platformsDir,
        repoPath: repoDir,
        allowPlaceholders: true,
        installSkill: false,
        installMcp: false,
        writeManifest: true,
      });

      expect(result.placeholdersUsed).toBe(true);
      expect(result.manifestPath).toBeDefined();
      const content = fs.readFileSync(result.manifestPath!, "utf8");
      expect(content).toContain("org_123");
      expect(content).toContain("proj_456");
    });

    it("throws when orgId is missing and placeholders not allowed", () => {
      writePlatformToml(platformsDir, "json-platform", jsonMapPlatformToml);

      expect(() =>
        installPlatforms({
          platformsDir,
          repoPath: repoDir,
          installSkill: false,
          installMcp: false,
          writeManifest: true,
        }),
      ).toThrow("--org-id is required");
    });
  });

  // ============================================================
  // installPlatforms - auth handoff
  // ============================================================
  describe("installPlatforms - auth handoff", () => {
    it("writes auth-handoff.toml when platform has interactive_handoff auth", () => {
      writePlatformToml(platformsDir, "auth-platform", authPlatformToml);

      const result = installPlatforms({
        platformsDir,
        repoPath: repoDir,
        installSkill: false,
        installMcp: true,
        writeManifest: false,
      });

      expect(result.authHandoffPath).toBeDefined();
      expect(fs.existsSync(result.authHandoffPath!)).toBe(true);
      const content = fs.readFileSync(result.authHandoffPath!, "utf8");
      expect(content).toContain("auth-platform");
      expect(content).toContain("Auth Platform");
    });
  });

  // ============================================================
  // cleanupPlatforms
  // ============================================================
  describe("cleanupPlatforms", () => {
    it("removes json_map MCP server entry", () => {
      const targetPath = path.join(tmpDir, ".json-platform", "mcp.json");
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(
        targetPath,
        JSON.stringify({
          mcpServers: {
            "decision-ops-mcp": { type: "http", url: "https://api.test.com/mcp" },
            "other-server": { type: "http", url: "https://other.com" },
          },
        }, null, 2),
        "utf8",
      );

      const customToml = jsonMapPlatformToml.replace(
        'install_path_default = "~/.json-platform/mcp.json"',
        `install_path_default = "${targetPath}"`,
      );
      writePlatformToml(platformsDir, "json-platform", customToml);

      const result = cleanupPlatforms({
        platformsDir,
        repoPath: repoDir,
        removeSkill: false,
        removeMcp: true,
      });

      expect(result.removedMcp.length).toBe(1);
      const content = JSON.parse(fs.readFileSync(targetPath, "utf8"));
      expect(content.mcpServers["decision-ops-mcp"]).toBeUndefined();
      expect(content.mcpServers["other-server"]).toBeDefined();
    });

    it("removes json file entirely when it becomes empty", () => {
      const targetPath = path.join(tmpDir, ".json-platform", "mcp.json");
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(
        targetPath,
        JSON.stringify({
          mcpServers: {
            "decision-ops-mcp": { type: "http", url: "https://api.test.com/mcp" },
          },
        }, null, 2),
        "utf8",
      );

      const customToml = jsonMapPlatformToml.replace(
        'install_path_default = "~/.json-platform/mcp.json"',
        `install_path_default = "${targetPath}"`,
      );
      writePlatformToml(platformsDir, "json-platform", customToml);

      cleanupPlatforms({
        platformsDir,
        repoPath: repoDir,
        removeSkill: false,
        removeMcp: true,
      });

      expect(fs.existsSync(targetPath)).toBe(false);
    });

    it("removes codex_toml MCP server entry", () => {
      const targetPath = path.join(tmpDir, ".codex-platform", "codex.toml");
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(
        targetPath,
        '[mcp_servers.decision-ops-mcp]\nenabled = true\nurl = "https://api.test.com/mcp"\n\n[mcp_servers.other]\nenabled = true\nurl = "https://other.com"\n',
        "utf8",
      );

      const customToml = codexTomlPlatformToml.replace(
        'install_path_default = "~/.codex-platform/codex.toml"',
        `install_path_default = "${targetPath}"`,
      );
      writePlatformToml(platformsDir, "codex-platform", customToml);

      const result = cleanupPlatforms({
        platformsDir,
        repoPath: repoDir,
        removeSkill: false,
        removeMcp: true,
      });

      expect(result.removedMcp.length).toBe(1);
      const content = fs.readFileSync(targetPath, "utf8");
      expect(content).not.toContain("[mcp_servers.decision-ops-mcp]");
      expect(content).toContain("[mcp_servers.other]");
    });

    it("removes codex toml file entirely when it becomes empty", () => {
      const targetPath = path.join(tmpDir, ".codex-platform", "codex.toml");
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(
        targetPath,
        '[mcp_servers.decision-ops-mcp]\nenabled = true\nurl = "https://api.test.com/mcp"\n',
        "utf8",
      );

      const customToml = codexTomlPlatformToml.replace(
        'install_path_default = "~/.codex-platform/codex.toml"',
        `install_path_default = "${targetPath}"`,
      );
      writePlatformToml(platformsDir, "codex-platform", customToml);

      cleanupPlatforms({
        platformsDir,
        repoPath: repoDir,
        removeSkill: false,
        removeMcp: true,
      });

      expect(fs.existsSync(targetPath)).toBe(false);
    });

    it("skips MCP removal when server is not found in config", () => {
      const targetPath = path.join(tmpDir, ".json-platform", "mcp.json");
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(
        targetPath,
        JSON.stringify({ mcpServers: { "other-server": { url: "https://x.com" } } }, null, 2),
        "utf8",
      );

      const customToml = jsonMapPlatformToml.replace(
        'install_path_default = "~/.json-platform/mcp.json"',
        `install_path_default = "${targetPath}"`,
      );
      writePlatformToml(platformsDir, "json-platform", customToml);

      const result = cleanupPlatforms({
        platformsDir,
        repoPath: repoDir,
        removeSkill: false,
        removeMcp: true,
      });

      expect(result.skippedMcp.length).toBe(1);
      expect(result.skippedMcp[0].reason).toContain("not found");
    });

    it("removes skill directory when it exists", () => {
      const skillPath = path.join(repoDir, ".json-platform", "skills", "decision-ops");
      fs.mkdirSync(skillPath, { recursive: true });
      fs.writeFileSync(path.join(skillPath, "SKILL.md"), "# Skill", "utf8");

      const customToml = `
id = "json-platform"
display_name = "JSON Platform"

[skill]
supported = true
build_path = ".decision-ops/skills/{skill_name}"
install_path_default = "{repo_path}/.json-platform/skills/{skill_name}"
scope = "project"

[mcp]
supported = true
build_path = ".json-platform/mcp.json"
format = "json_map"
root_key = "mcpServers"
install_path_default = "~/.json-platform/mcp.json"
scope = "user"
`;
      writePlatformToml(platformsDir, "json-platform", customToml);

      const result = cleanupPlatforms({
        platformsDir,
        repoPath: repoDir,
        removeSkill: true,
        removeMcp: false,
      });

      expect(result.removedSkills.length).toBe(1);
      expect(fs.existsSync(skillPath)).toBe(false);
    });

    it("skips skill removal when path does not exist", () => {
      const customToml = `
id = "json-platform"
display_name = "JSON Platform"

[skill]
supported = true
build_path = ".decision-ops/skills/{skill_name}"
install_path_default = "{repo_path}/.json-platform/skills/{skill_name}"
scope = "project"

[mcp]
supported = true
build_path = ".json-platform/mcp.json"
format = "json_map"
root_key = "mcpServers"
install_path_default = "~/.json-platform/mcp.json"
scope = "user"
`;
      writePlatformToml(platformsDir, "json-platform", customToml);

      const result = cleanupPlatforms({
        platformsDir,
        repoPath: repoDir,
        removeSkill: true,
        removeMcp: false,
      });

      expect(result.skippedSkills.length).toBe(1);
      expect(result.skippedSkills[0].reason).toContain("does not exist");
    });

    it("removes manifest and auth-handoff when requested", () => {
      // Create manifest and auth-handoff files
      const decisionopsDir = path.join(repoDir, ".decisionops");
      fs.mkdirSync(decisionopsDir, { recursive: true });
      fs.writeFileSync(path.join(decisionopsDir, "manifest.toml"), "version = 1\n", "utf8");
      fs.writeFileSync(path.join(decisionopsDir, "auth-handoff.toml"), "version = 1\n", "utf8");

      writePlatformToml(platformsDir, "json-platform", jsonMapPlatformToml);

      const result = cleanupPlatforms({
        platformsDir,
        repoPath: repoDir,
        removeSkill: false,
        removeMcp: false,
        removeManifest: true,
        removeAuthHandoff: true,
      });

      expect(result.removedManifestPath).toBeDefined();
      expect(result.removedAuthHandoffPath).toBeDefined();
      expect(fs.existsSync(path.join(decisionopsDir, "manifest.toml"))).toBe(false);
      expect(fs.existsSync(path.join(decisionopsDir, "auth-handoff.toml"))).toBe(false);
      // .decisionops dir should be removed since it's now empty
      expect(fs.existsSync(decisionopsDir)).toBe(false);
    });
  });

  // ============================================================
  // installPlatforms - error cases
  // ============================================================
  describe("installPlatforms - error handling", () => {
    it("throws when sourceDir is missing SKILL.md", () => {
      writePlatformToml(platformsDir, "json-platform", jsonMapPlatformToml);
      const badSourceDir = path.join(tmpDir, "bad-source");
      fs.mkdirSync(badSourceDir, { recursive: true });

      expect(() =>
        installPlatforms({
          platformsDir,
          repoPath: repoDir,
          sourceDir: badSourceDir,
          outputDir,
          installSkill: true,
          installMcp: false,
          writeManifest: false,
        }),
      ).toThrow("Skill source missing SKILL.md");
    });

    it("throws when skill install is requested without a sourceDir", () => {
      const customToml = `
id = "json-platform"
display_name = "JSON Platform"

[skill]
supported = true
build_path = ".decision-ops/skills/{skill_name}"
install_path_default = "{repo_path}/.json-platform/skills/{skill_name}"
scope = "project"
`;
      writePlatformToml(platformsDir, "json-platform", customToml);

      expect(() =>
        installPlatforms({
          platformsDir,
          repoPath: repoDir,
          installSkill: true,
          installMcp: false,
          writeManifest: false,
        }),
      ).toThrow("Skill source is required to install skill files");
    });

    it("throws when repoPath is required but not provided", () => {
      writePlatformToml(platformsDir, "json-platform", jsonMapPlatformToml);

      expect(() =>
        installPlatforms({
          platformsDir,
          repoPath: null,
          installSkill: false,
          installMcp: false,
          writeManifest: true,
        }),
      ).toThrow("--repo-path is required");
    });

    it("uses custom serverName and serverUrl", () => {
      writePlatformToml(platformsDir, "codex-platform", codexTomlPlatformToml);

      const result = installPlatforms({
        platformsDir,
        repoPath: repoDir,
        installSkill: false,
        installMcp: true,
        writeManifest: false,
        serverName: "my-custom-server",
        serverUrl: "https://custom.mcp.com/api",
      });

      expect(result.installedMcp.length).toBe(1);
      const content = fs.readFileSync(result.installedMcp[0].target, "utf8");
      expect(content).toContain("[mcp_servers.my-custom-server]");
      expect(content).toContain('url = "https://custom.mcp.com/api"');
    });
  });
});
