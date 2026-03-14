import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { findPlatformsDir, findSkillSourceDir } from "../core/resources.js";

describe("resources", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dops-resources-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finds adjacent platform definitions from a nested binary-style directory", () => {
    const workspaceDir = path.join(tmpDir, "decision-ops-integrations");
    const cliDistDir = path.join(workspaceDir, "cli", "dist");
    const platformsDir = path.join(workspaceDir, "skill", "platforms");

    fs.mkdirSync(cliDistDir, { recursive: true });
    fs.mkdirSync(platformsDir, { recursive: true });
    fs.writeFileSync(path.join(platformsDir, "codex.toml"), 'id = "codex"\ndisplay_name = "Codex"\n', "utf8");

    expect(findPlatformsDir([cliDistDir])).toBe(platformsDir);
  });

  it("finds adjacent skill bundle from a nested binary-style directory", () => {
    const workspaceDir = path.join(tmpDir, "decision-ops-integrations");
    const cliDistDir = path.join(workspaceDir, "cli", "dist");
    const skillDir = path.join(workspaceDir, "skill", "decision-ops");

    fs.mkdirSync(cliDistDir, { recursive: true });
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "# Decision Ops\n", "utf8");

    expect(findSkillSourceDir([cliDistDir])).toBe(skillDir);
  });
});
