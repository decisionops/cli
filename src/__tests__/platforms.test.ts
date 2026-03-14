import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  formatTemplate,
  expandPath,
  contextForPaths,
  selectPlatforms,
  resolveInstallPath,
  authInstructions,
  loadPlatforms,
  type PlatformDefinition,
  type PlatformInstallSpec,
} from "../core/platforms.js";

function makePlatform(overrides: Partial<PlatformDefinition> & { id: string }): PlatformDefinition {
  return {
    display_name: overrides.id,
    __file__: `/fake/${overrides.id}.toml`,
    ...overrides,
  };
}

describe("formatTemplate", () => {
  it("replaces {key} with context values", () => {
    expect(formatTemplate("hello {name}", { name: "world" })).toBe("hello world");
  });

  it("replaces multiple keys", () => {
    expect(formatTemplate("{a}/{b}/{a}", { a: "x", b: "y" })).toBe("x/y/x");
  });

  it("throws when a template variable is missing", () => {
    expect(() => formatTemplate("{missing}", {})).toThrow("Missing template variable 'missing'");
  });

  it("returns string unchanged when no placeholders", () => {
    expect(formatTemplate("no placeholders here", {})).toBe("no placeholders here");
  });

  it("handles empty string template", () => {
    expect(formatTemplate("", {})).toBe("");
  });
});

describe("expandPath", () => {
  const originalHome = process.env.HOME;

  afterEach(() => {
    if (originalHome !== undefined) process.env.HOME = originalHome;
    else delete process.env.HOME;
  });

  it("expands both template vars and tilde", () => {
    process.env.HOME = "/home/user";
    expect(expandPath("~/.config/{skill_name}", { skill_name: "my-skill" })).toBe(
      "/home/user/.config/my-skill",
    );
  });

  it("works with no tilde", () => {
    expect(expandPath("/absolute/{skill_name}", { skill_name: "test" })).toBe("/absolute/test");
  });
});

describe("contextForPaths", () => {
  it("returns skill_name and repo_path", () => {
    const ctx = contextForPaths("my-skill", "/repo");
    expect(ctx).toEqual({ skill_name: "my-skill", repo_path: "/repo" });
  });

  it("sets repo_path to empty string when null", () => {
    const ctx = contextForPaths("my-skill", null);
    expect(ctx).toEqual({ skill_name: "my-skill", repo_path: "" });
  });
});

describe("selectPlatforms", () => {
  const platforms: Record<string, PlatformDefinition> = {
    alpha: makePlatform({
      id: "alpha",
      skill: { supported: true },
      mcp: { supported: true, format: "json_map" },
    }),
    beta: makePlatform({
      id: "beta",
      skill: { supported: false },
      mcp: { supported: true, format: "codex_toml" },
    }),
    gamma: makePlatform({
      id: "gamma",
      skill: { supported: true },
      mcp: { supported: false },
    }),
  };

  it("returns all platforms when no selectedIds provided", () => {
    const result = selectPlatforms(platforms);
    expect(result.map((p) => p.id)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("returns only requested platforms in order", () => {
    const result = selectPlatforms(platforms, ["gamma", "alpha"]);
    expect(result.map((p) => p.id)).toEqual(["gamma", "alpha"]);
  });

  it("throws for unknown platform ids", () => {
    expect(() => selectPlatforms(platforms, ["alpha", "unknown"])).toThrow("Unknown platform(s): unknown");
  });

  it("filters by capability when specified", () => {
    const result = selectPlatforms(platforms, undefined, "skill");
    expect(result.map((p) => p.id)).toEqual(["alpha", "gamma"]);
  });

  it("filters by mcp capability", () => {
    const result = selectPlatforms(platforms, undefined, "mcp");
    expect(result.map((p) => p.id)).toEqual(["alpha", "beta"]);
  });

  it("returns empty array when no platforms match capability", () => {
    const result = selectPlatforms(platforms, undefined, "manifest");
    expect(result).toEqual([]);
  });

  it("returns all when selectedIds is empty array", () => {
    const result = selectPlatforms(platforms, []);
    expect(result.map((p) => p.id)).toEqual(["alpha", "beta", "gamma"]);
  });
});

describe("resolveInstallPath", () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    originalEnv.HOME = process.env.HOME;
    originalEnv.TEST_INSTALL_PATH = process.env.TEST_INSTALL_PATH;
    originalEnv.TEST_INSTALL_ROOT = process.env.TEST_INSTALL_ROOT;
    process.env.HOME = "/home/testuser";
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value !== undefined) process.env[key] = value;
      else delete process.env[key];
    }
  });

  it("returns null when no path spec fields are set", () => {
    const spec: PlatformInstallSpec = { supported: true };
    expect(resolveInstallPath(spec, { skill_name: "test", repo_path: "" })).toBeNull();
  });

  it("uses install_path_env when env var is set", () => {
    process.env.TEST_INSTALL_PATH = "/custom/path";
    const spec: PlatformInstallSpec = {
      supported: true,
      install_path_env: "TEST_INSTALL_PATH",
      install_path_default: "~/default",
    };
    const result = resolveInstallPath(spec, { skill_name: "test", repo_path: "" });
    expect(result).toBe("/custom/path");
  });

  it("uses install_path_default when no env is set", () => {
    const spec: PlatformInstallSpec = {
      supported: true,
      install_path_default: "~/.config/{skill_name}/config.json",
    };
    const result = resolveInstallPath(spec, { skill_name: "my-skill", repo_path: "" });
    expect(result).toBe("/home/testuser/.config/my-skill/config.json");
  });

  it("returns null when install_path_default requires repo_path but repo_path is empty", () => {
    const spec: PlatformInstallSpec = {
      supported: true,
      install_path_default: "{repo_path}/.config/file",
    };
    const result = resolveInstallPath(spec, { skill_name: "test", repo_path: "" });
    expect(result).toBeNull();
  });

  it("uses install_root_env + install_path_suffix", () => {
    process.env.TEST_INSTALL_ROOT = "/custom/root";
    const spec: PlatformInstallSpec = {
      supported: true,
      install_root_env: "TEST_INSTALL_ROOT",
      install_path_suffix: "{skill_name}/config.json",
    };
    const result = resolveInstallPath(spec, { skill_name: "my-skill", repo_path: "" });
    expect(result).toBe("/custom/root/my-skill/config.json");
  });

  it("falls back to install_root_default when install_root_env not set", () => {
    delete process.env.TEST_INSTALL_ROOT;
    const spec: PlatformInstallSpec = {
      supported: true,
      install_root_env: "TEST_INSTALL_ROOT",
      install_root_default: "~/.local",
      install_path_suffix: "sub/{skill_name}",
    };
    const result = resolveInstallPath(spec, { skill_name: "s", repo_path: "" });
    expect(result).toBe("/home/testuser/.local/sub/s");
  });

  it("returns null when install_root_default is empty and env not set", () => {
    const spec: PlatformInstallSpec = {
      supported: true,
      install_root_env: "NONEXISTENT_ENV_VAR_XYZ",
    };
    const result = resolveInstallPath(spec, { skill_name: "test", repo_path: "" });
    expect(result).toBeNull();
  });
});

describe("authInstructions", () => {
  it("returns null when auth mode is not interactive_handoff", () => {
    const platform = makePlatform({ id: "test" });
    expect(authInstructions(platform, {})).toBeNull();
  });

  it("returns null when auth is undefined", () => {
    const platform = makePlatform({ id: "test" });
    expect(authInstructions(platform, {})).toBeNull();
  });

  it("returns empty array when mode is interactive_handoff but no instructions", () => {
    const platform = makePlatform({
      id: "test",
      auth: { mode: "interactive_handoff" },
    });
    expect(authInstructions(platform, {})).toEqual([]);
  });

  it("applies template formatting to instruction steps", () => {
    const platform = makePlatform({
      id: "test",
      auth: {
        mode: "interactive_handoff",
        instructions: [
          "Open {mcp_config_path}",
          "Add token for {display_name}",
        ],
      },
    });
    const result = authInstructions(platform, {
      mcp_config_path: "/home/.config.json",
      display_name: "Test Platform",
    });
    expect(result).toEqual([
      "Open /home/.config.json",
      "Add token for Test Platform",
    ]);
  });
});

describe("loadPlatforms", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dops-platforms-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads platform TOML files from a directory", () => {
    fs.writeFileSync(
      path.join(tmpDir, "test-platform.toml"),
      'id = "test-platform"\ndisplay_name = "Test Platform"\n\n[mcp]\nsupported = true\nformat = "json_map"\n',
      "utf8",
    );
    const platforms = loadPlatforms(tmpDir);
    expect(platforms["test-platform"]).toBeDefined();
    expect(platforms["test-platform"].display_name).toBe("Test Platform");
    expect(platforms["test-platform"].mcp?.supported).toBe(true);
  });

  it("throws when directory has no TOML files", () => {
    expect(() => loadPlatforms(tmpDir)).toThrow("No platform definitions found");
  });

  it("throws when id is missing", () => {
    fs.writeFileSync(path.join(tmpDir, "bad.toml"), 'display_name = "Bad"\n', "utf8");
    expect(() => loadPlatforms(tmpDir)).toThrow("missing id");
  });

  it("throws when id does not match filename", () => {
    fs.writeFileSync(path.join(tmpDir, "mismatch.toml"), 'id = "wrong"\ndisplay_name = "X"\n', "utf8");
    expect(() => loadPlatforms(tmpDir)).toThrow("must match filename");
  });

  it("ignores non-TOML files", () => {
    fs.writeFileSync(path.join(tmpDir, "readme.md"), "# Readme", "utf8");
    fs.writeFileSync(
      path.join(tmpDir, "valid.toml"),
      'id = "valid"\ndisplay_name = "Valid"\n',
      "utf8",
    );
    const platforms = loadPlatforms(tmpDir);
    expect(Object.keys(platforms)).toEqual(["valid"]);
  });
});
