import { describe, it, expect } from "bun:test";
import path from "node:path";

const CLI_PATH = path.resolve(import.meta.dir, "..", "cli.ts");

function runCli(...args: string[]) {
  const result = Bun.spawnSync(["bun", "run", CLI_PATH, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

describe("CLI entry point", () => {
  it("prints help text with --help and exits 0", () => {
    const result = runCli("--help");
    expect(result.exitCode).toBe(0);
    const output = result.stdout;
    expect(output).toContain("dops");
    expect(output).toContain("Usage:");
    expect(output).toContain("Commands:");
    expect(output).toContain("Examples:");
    expect(output).toContain("dops install --platform codex");
    expect(output).toContain("dops update");
  });

  it("prints version with --version and exits 0", () => {
    const result = runCli("--version");
    expect(result.exitCode).toBe(0);
    const output = result.stdout;
    expect(output.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("prints help for login subcommand", () => {
    const result = runCli("login", "--help");
    expect(result.exitCode).toBe(0);
    const output = result.stdout;
    expect(output).toContain("Authenticate");
    expect(output).toContain("--api-base-url");
    expect(output).not.toContain("--with-token");
  });

  it("prints help for install subcommand", () => {
    const result = runCli("install", "--help");
    expect(result.exitCode).toBe(0);
    const output = result.stdout;
    expect(output).toContain("Install");
    expect(output).toContain("--platform");
    expect(output).toContain("Examples:");
    expect(output).toContain("dops install --platform claude-code");
    expect(output).toContain("Supported platform ids: codex, claude-code, cursor, vscode, antigravity");
  });

  it("prints examples for init subcommand", () => {
    const result = runCli("init", "--help");
    expect(result.exitCode).toBe(0);
    const output = result.stdout;
    expect(output).toContain("Examples:");
    expect(output).toContain("dops init --org-id acme --project-id backend --repo-ref acme/backend");
  });

  it("prints help for update subcommand", () => {
    const result = runCli("update", "--help");
    expect(result.exitCode).toBe(0);
    const output = result.stdout;
    expect(output).toContain("Update the dops CLI");
    expect(output).toContain("--version <tag>");
    expect(output).toContain("dops update --version v0.1.0");
  });

  it("prints help for decisions subcommand", () => {
    const result = runCli("decisions", "--help");
    expect(result.exitCode).toBe(0);
    const output = result.stdout;
    expect(output).toContain("decisions");
  });

  it("exits with error for unknown commands", () => {
    const result = runCli("nonexistent-command");
    expect(result.exitCode).not.toBe(0);
  });
});
