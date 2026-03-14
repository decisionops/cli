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
  });

  it("prints help for install subcommand", () => {
    const result = runCli("install", "--help");
    expect(result.exitCode).toBe(0);
    const output = result.stdout;
    expect(output).toContain("Install");
    expect(output).toContain("--platform");
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
