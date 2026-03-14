#!/usr/bin/env bun
import process from "node:process";

import { Command } from "commander";
import { z } from "zod";

import { isCancelError } from "./ui/cancel.js";
import { installTerminalSafetyNet } from "./ui/terminal.js";

const program = new Command();
program
  .name("dops")
  .description("dops — repo-anchored CLI for working with decisions\n\nRespects NO_COLOR and FORCE_COLOR environment variables.")
  .version("0.1.0");

// Auth commands
program
  .command("login")
  .description("Authenticate this machine with DecisionOps")
  .option("--api-base-url <url>", "DecisionOps API base URL")
  .option("--issuer-url <url>", "OAuth issuer base URL")
  .option("--client-id <id>", "OAuth client id")
  .option("--audience <value>", "OAuth audience")
  .option("--scopes <list>", "Comma or space separated OAuth scopes")
  .option("--web", "Use browser-based PKCE login")
  .option("--with-token", "Save a raw access token instead of using OAuth")
  .option("--token <token>", "Access token value for --with-token")
  .option("--no-browser", "Do not attempt to launch a browser automatically")
  .option("--clear", "Remove saved login state")
  .action(async (flags) => {
    const { runLogin } = await import("./commands/login.js");
    await runLogin(flags);
  });

program
  .command("logout")
  .description("Revoke and remove the local DecisionOps session")
  .action(async () => {
    const { runLogout } = await import("./commands/logout.js");
    await runLogout();
  });

const authCommand = program.command("auth").description("Inspect or manage the current DecisionOps auth session");

authCommand
  .command("status")
  .description("Show the current auth session")
  .action(async () => {
    const { runAuthStatus } = await import("./commands/auth-status.js");
    await runAuthStatus();
  });

// Repo setup
program
  .command("init")
  .description("Bind the current repository to a DecisionOps project")
  .option("--repo-path <path>")
  .option("--api-base-url <url>", "DecisionOps API base URL")
  .option("--org-id <orgId>")
  .option("--project-id <projectId>")
  .option("--repo-ref <repoRef>")
  .option("--repo-id <repoId>")
  .option("--default-branch <branch>")
  .option("--user-session-token <token>", "DecisionOps user session token")
  .option("--allow-placeholders", "Allow placeholder manifest values for local prototyping")
  .option("--server-name <name>", "MCP server name")
  .option("--server-url <url>", "MCP server URL")
  .action(async (flags) => {
    const { runInit } = await import("./commands/init.js");
    await runInit(flags);
  });

function collectValues(value: string, previous: string[]) {
  previous.push(value);
  return previous;
}

// Install / uninstall
program
  .command("install")
  .description("Install DecisionOps skill + MCP config for chosen platforms")
  .option("-p, --platform <id>", "Select a platform to install", collectValues, [])
  .option("--repo-path <path>")
  .option("--api-base-url <url>", "DecisionOps API base URL")
  .option("--org-id <orgId>")
  .option("--project-id <projectId>")
  .option("--repo-ref <repoRef>")
  .option("--repo-id <repoId>")
  .option("--default-branch <branch>")
  .option("--user-session-token <token>")
  .option("--allow-placeholders")
  .option("--skip-manifest")
  .option("--skip-skill")
  .option("--skip-mcp")
  .option("--output-dir <path>")
  .option("--source-dir <path>")
  .option("--skill-name <name>")
  .option("--server-name <name>")
  .option("--server-url <url>")
  .option("-y, --yes", "Accept interactive defaults")
  .action(async (flags) => {
    const { runInstall } = await import("./commands/install.js");
    await runInstall(flags);
  });

program
  .command("uninstall")
  .alias("cleanup")
  .description("Remove installed DecisionOps skills, MCP entries, and local auth state")
  .option("-p, --platform <id>", "Select a platform to clean up", collectValues, [])
  .option("--repo-path <path>")
  .option("--skill-name <name>")
  .option("--server-name <name>")
  .option("--skip-skill")
  .option("--skip-mcp")
  .option("--skip-auth")
  .option("--remove-manifest")
  .option("--remove-auth-handoff")
  .action(async (flags) => {
    const { runUninstall } = await import("./commands/uninstall.js");
    await runUninstall(flags);
  });

// Doctor
program
  .command("doctor")
  .description("Diagnose local DecisionOps setup and suggest fixes")
  .option("--repo-path <path>")
  .action(async (flags) => {
    const { runDoctor } = await import("./commands/doctor.js");
    await runDoctor(flags);
  });

// Decision operations
const decisionsCommand = program.command("decisions").description("Work with decisions");

decisionsCommand
  .command("list")
  .description("List decisions")
  .option("--status <status>", "Filter by status (proposed, accepted, deprecated, superseded)")
  .option("--type <type>", "Filter by type (technical, product, business, governance)")
  .option("--limit <n>", "Max results", "20")
  .option("--repo-path <path>")
  .action(async (flags) => {
    const { runDecisionsList } = await import("./commands/decisions.js");
    await runDecisionsList(flags);
  });

decisionsCommand
  .command("get <id>")
  .description("Get a decision by ID")
  .option("--repo-path <path>")
  .action(async (id, flags) => {
    const { runDecisionsGet } = await import("./commands/decisions.js");
    await runDecisionsGet(id, flags);
  });

decisionsCommand
  .command("search <terms...>")
  .description("Search decisions by keywords")
  .option("--mode <mode>", "Search mode: semantic or keyword")
  .option("--repo-path <path>")
  .action(async (terms, flags) => {
    const { runDecisionsSearch } = await import("./commands/decisions.js");
    await runDecisionsSearch(terms.join(" "), flags);
  });

decisionsCommand
  .command("create")
  .description("Create a new decision (interactive)")
  .option("--repo-path <path>")
  .action(async (flags) => {
    const { runDecisionsCreate } = await import("./commands/decisions.js");
    await runDecisionsCreate(flags);
  });

// Gate
program
  .command("gate")
  .description("Run decision gate on current task")
  .option("--task <summary>", "Task summary")
  .option("--repo-path <path>")
  .action(async (flags) => {
    const { runGate } = await import("./commands/gate.js");
    await runGate(flags);
  });

// Validate
program
  .command("validate [id]")
  .description("Validate a decision against org constraints")
  .option("--repo-path <path>")
  .action(async (id, flags) => {
    const { runValidate } = await import("./commands/validate.js");
    await runValidate(id, flags);
  });

// Publish
program
  .command("publish <id>")
  .description("Publish a proposed decision (transition to accepted)")
  .option("--version <n>", "Expected version")
  .option("--repo-path <path>")
  .action(async (id, flags) => {
    const { runPublish } = await import("./commands/publish.js");
    await runPublish(id, flags);
  });

// Status / governance
program
  .command("status")
  .description("Governance snapshot: coverage, health, drift, alerts")
  .option("--repo-path <path>")
  .action(async (flags) => {
    const { runStatus } = await import("./commands/status.js");
    await runStatus(flags);
  });

// Platform
const platformCommand = program.command("platform").description("Platform registry operations");

platformCommand
  .command("list")
  .description("List supported platforms")
  .action(async () => {
    const { runPlatformList } = await import("./commands/platform.js");
    await runPlatformList();
  });

platformCommand
  .command("build")
  .description("Build platform bundles")
  .option("-p, --platform <id>", "Select a platform to build", collectValues, [])
  .option("--output-dir <path>")
  .option("--source-dir <path>")
  .option("--skill-name <name>")
  .option("--server-name <name>")
  .option("--server-url <url>")
  .action(async (flags) => {
    const { runPlatformBuild } = await import("./commands/platform.js");
    await runPlatformBuild(flags);
  });

installTerminalSafetyNet();

program.parseAsync(process.argv).catch((error: unknown) => {
  if (isCancelError(error)) {
    console.log("\nCancelled.");
    process.exit(0);
  }
  const message = error instanceof z.ZodError
    ? error.issues.map((issue) => issue.message).join(", ")
    : error instanceof Error
      ? error.message
      : String(error);
  console.error(message);
  process.exitCode = 1;
});
