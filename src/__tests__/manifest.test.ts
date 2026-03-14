import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeManifest, readManifest, writeAuthHandoff, type ManifestValues } from "../core/manifest.js";

describe("manifest", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dops-manifest-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const sampleValues: ManifestValues = {
    org_id: "org_abc",
    project_id: "proj_xyz",
    repo_ref: "owner/repo",
    default_branch: "main",
    mcp_server_name: "decision-ops-mcp",
    mcp_server_url: "https://api.example.com/mcp",
  };

  describe("writeManifest", () => {
    it("creates the .decisionops directory and manifest.toml", () => {
      const filePath = writeManifest(tmpDir, sampleValues);
      expect(filePath).toBe(path.join(tmpDir, ".decisionops", "manifest.toml"));
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it("writes valid TOML content with all fields", () => {
      const filePath = writeManifest(tmpDir, sampleValues);
      const content = fs.readFileSync(filePath, "utf8");
      expect(content).toContain('org_id = "org_abc"');
      expect(content).toContain('project_id = "proj_xyz"');
      expect(content).toContain('repo_ref = "owner/repo"');
      expect(content).toContain('default_branch = "main"');
      expect(content).toContain('mcp_server_name = "decision-ops-mcp"');
      expect(content).toContain('mcp_server_url = "https://api.example.com/mcp"');
      expect(content).toContain("version = 1");
    });

    it("includes repo_id when provided", () => {
      const filePath = writeManifest(tmpDir, { ...sampleValues, repo_id: "repo_999" });
      const content = fs.readFileSync(filePath, "utf8");
      expect(content).toContain('repo_id = "repo_999"');
    });

    it("omits repo_id when not provided", () => {
      const filePath = writeManifest(tmpDir, sampleValues);
      const content = fs.readFileSync(filePath, "utf8");
      expect(content).not.toContain("repo_id");
    });

    it("overwrites an existing manifest", () => {
      writeManifest(tmpDir, sampleValues);
      const updated = { ...sampleValues, org_id: "org_new" };
      const filePath = writeManifest(tmpDir, updated);
      const content = fs.readFileSync(filePath, "utf8");
      expect(content).toContain('org_id = "org_new"');
      expect(content).not.toContain('org_id = "org_abc"');
    });
  });

  describe("readManifest", () => {
    it("returns null when manifest does not exist", () => {
      expect(readManifest(tmpDir)).toBeNull();
    });

    it("round-trips values through write then read", () => {
      writeManifest(tmpDir, sampleValues);
      const result = readManifest(tmpDir);
      expect(result).not.toBeNull();
      expect(result!.version).toBe(1);
      expect(result!.org_id).toBe("org_abc");
      expect(result!.project_id).toBe("proj_xyz");
      expect(result!.repo_ref).toBe("owner/repo");
      expect(result!.default_branch).toBe("main");
      expect(result!.mcp_server_name).toBe("decision-ops-mcp");
      expect(result!.mcp_server_url).toBe("https://api.example.com/mcp");
    });

    it("round-trips values with repo_id", () => {
      writeManifest(tmpDir, { ...sampleValues, repo_id: "repo_42" });
      const result = readManifest(tmpDir);
      expect(result!.repo_id).toBe("repo_42");
    });
  });

  describe("writeAuthHandoff", () => {
    it("writes auth-handoff.toml inside .decisionops when repoPath is given", () => {
      const entries = [
        {
          id: "claude-code",
          display_name: "Claude Code",
          mode: "interactive_handoff",
          platform_definition: "/some/file.toml",
          mcp_config_path: "/home/user/.claude.json",
          instructions: ["Step 1: do something", "Step 2: do another thing"],
        },
      ];
      const filePath = writeAuthHandoff(tmpDir, "", entries);
      expect(filePath).toBe(path.join(tmpDir, ".decisionops", "auth-handoff.toml"));
      expect(fs.existsSync(filePath)).toBe(true);
      const content = fs.readFileSync(filePath, "utf8");
      expect(content).toContain("version = 1");
      expect(content).toContain("claude-code");
      expect(content).toContain("Claude Code");
    });

    it("writes auth-handoff.toml to outputDir when repoPath is null", () => {
      const outputDir = path.join(tmpDir, "output");
      fs.mkdirSync(outputDir, { recursive: true });
      const entries = [
        {
          id: "test",
          display_name: "Test",
          mode: "interactive_handoff",
          platform_definition: "/test.toml",
          mcp_config_path: "/test/path",
          instructions: ["Do X"],
        },
      ];
      const filePath = writeAuthHandoff(null, outputDir, entries);
      expect(filePath).toBe(path.join(outputDir, "auth-handoff.toml"));
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it("writes multiple entries", () => {
      const entries = [
        {
          id: "platform-a",
          display_name: "Platform A",
          mode: "interactive_handoff",
          platform_definition: "/a.toml",
          mcp_config_path: "/a/path",
          instructions: ["Step A1"],
        },
        {
          id: "platform-b",
          display_name: "Platform B",
          mode: "interactive_handoff",
          platform_definition: "/b.toml",
          mcp_config_path: "/b/path",
          instructions: ["Step B1", "Step B2"],
        },
      ];
      const filePath = writeAuthHandoff(tmpDir, "", entries);
      const content = fs.readFileSync(filePath, "utf8");
      expect(content).toContain("platform-a");
      expect(content).toContain("platform-b");
    });
  });
});
