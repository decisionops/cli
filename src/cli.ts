#!/usr/bin/env bun
import process from "node:process";

import { Command, Option } from "commander";
import { z } from "zod";

import { isCancelError } from "./ui/cancel.js";
import { installTerminalSafetyNet } from "./ui/terminal.js";

const program = new Command();
const SUPPORTED_PLATFORM_IDS = ["codex", "claude-code", "cursor", "vscode", "antigravity"] as const;

function formatHelpSection(title: string, lines: string[]): string {
  return `\n${title}:\n${lines.map((line) => `  ${line}`).join("\n")}\n`;
}

function addExamples(command: Command, examples: string[]): Command {
  return command.addHelpText("after", formatHelpSection("Examples", examples));
}

function addNotes(command: Command, lines: string[]): Command {
  return command.addHelpText("after", formatHelpSection("Notes", lines));
}

program
  .name("dops")
  .description("dops — repo-anchored CLI for working with decisions\n\nRespects NO_COLOR and FORCE_COLOR environment variables.")
  .version("0.1.0");

addExamples(program, [
  "dops login",
  "dops init --org-id acme --project-id backend --repo-ref acme/backend",
  "dops install --platform codex",
  "dops update",
  "dops doctor",
]);

// Auth commands
addExamples(
  program
  .command("login")
  .description("Authenticate this machine with DecisionOps")
  .option("--api-base-url <url>", "DecisionOps API base URL")
  .option("--issuer-url <url>", "OAuth issuer base URL")
  .option("--client-id <id>", "OAuth client id")
  .option("--audience <value>", "OAuth audience")
  .option("--scopes <list>", "Comma or space separated OAuth scopes")
  .option("--web", "Use browser-based PKCE login (default)")
  .addOption(new Option("--with-token", "Use an already-issued bearer access token").hideHelp())
  .addOption(new Option("--token <token>", "Bearer access token value for --with-token").hideHelp())
  .option("--no-browser", "Do not attempt to launch a browser automatically")
  .option("--force", "Start a new browser login even if a saved session already exists")
  .option("--clear", "Remove saved login state")
  .action(async (flags) => {
    const { runLogin } = await import("./commands/login.js");
    await runLogin(flags);
  }),
  [
    "dops login",
    "dops login --web",
  ],
);

program
  .command("logout")
  .description("Revoke and remove the local DecisionOps session")
  .action(async () => {
    const { runLogout } = await import("./commands/logout.js");
    await runLogout();
  });

const authCommand = program.command("auth").description("Inspect or manage the current DecisionOps auth session");
addExamples(authCommand, [
  "dops auth status",
]);

authCommand
  .command("status")
  .description("Show the current auth session")
  .action(async () => {
    const { runAuthStatus } = await import("./commands/auth-status.js");
    await runAuthStatus();
  });

// Repo setup
addExamples(
  program
  .command("init")
  .description("Bind the current repository to a DecisionOps project")
  .option("--repo-path <path>", "Repository to bind (defaults to current working tree)")
  .option("--api-base-url <url>", "DecisionOps API base URL")
  .option("--org-id <orgId>", "DecisionOps organization id")
  .option("--project-id <projectId>", "DecisionOps project id")
  .option("--repo-ref <repoRef>", "Canonical repository ref, for example acme/backend")
  .option("--repo-id <repoId>", "DecisionOps repository id")
  .option("--default-branch <branch>", "Default branch name to record in the manifest")
  .option("--user-session-token <token>", "DecisionOps user session token")
  .option("--allow-placeholders", "Allow placeholder manifest values for local prototyping")
  .option("--server-name <name>", "MCP server name")
  .option("--server-url <url>", "MCP server URL")
  .action(async (flags) => {
    const { runInit } = await import("./commands/init.js");
    await runInit(flags);
  }),
  [
    "dops init --org-id acme --project-id backend --repo-ref acme/backend",
    "dops init --allow-placeholders",
  ],
);

function collectValues(value: string, previous: string[]) {
  previous.push(value);
  return previous;
}

// Install / uninstall
addNotes(
  addExamples(
    program
  .command("install")
  .description("Install DecisionOps skill + MCP config for chosen platforms")
  .option(
    "-p, --platform <id>",
    `Select a platform to install. Run 'dops platform list' for valid ids (${SUPPORTED_PLATFORM_IDS.join(", ")})`,
    collectValues,
    [],
  )
  .option("--repo-path <path>", "Repository to install into (defaults to current working tree)")
  .option("--api-base-url <url>", "DecisionOps API base URL")
  .option("--org-id <orgId>", "DecisionOps organization id override")
  .option("--project-id <projectId>", "DecisionOps project id override")
  .option("--repo-ref <repoRef>", "Repository ref override, for example acme/backend")
  .option("--repo-id <repoId>", "DecisionOps repository id override")
  .option("--default-branch <branch>", "Default branch override for generated config")
  .option("--user-session-token <token>", "DecisionOps user session token override")
  .option("--allow-placeholders", "Allow placeholder manifest values for local prototyping")
  .option("--skip-manifest", "Do not write the DecisionOps manifest entry")
  .option("--skip-skill", "Only write MCP config, skip skill installation")
  .option("--skip-mcp", "Only install the skill files, skip MCP config")
  .option("--output-dir <path>", "Write generated files to a staging directory instead of installing in place")
  .option("--source-dir <path>", "Override the DecisionOps skill source bundle directory")
  .option("--skill-name <name>", "Override the installed skill directory name")
  .option("--server-name <name>", "Override the MCP server name")
  .option("--server-url <url>", "Override the MCP server URL")
  .option("-y, --yes", "Accept interactive defaults")
  .action(async (flags) => {
    const { runInstall } = await import("./commands/install.js");
    await runInstall(flags);
  }),
    [
      "dops install --platform codex",
      "dops install --platform claude-code",
      "dops install --platform codex --platform cursor",
      "dops install --platform codex --skip-mcp",
    ],
  ),
  [
    `Supported platform ids: ${SUPPORTED_PLATFORM_IDS.join(", ")}`,
  ],
);

addNotes(
  addExamples(
    program
  .command("uninstall")
  .alias("cleanup")
  .description("Remove installed DecisionOps skills, MCP entries, and local auth state")
  .option(
    "-p, --platform <id>",
    `Select a platform to clean up. Run 'dops platform list' for valid ids (${SUPPORTED_PLATFORM_IDS.join(", ")})`,
    collectValues,
    [],
  )
  .option("--repo-path <path>", "Repository to clean up (defaults to current working tree)")
  .option("--skill-name <name>", "Installed skill directory name override")
  .option("--server-name <name>", "MCP server name override")
  .option("--skip-skill", "Leave installed skill files in place")
  .option("--skip-mcp", "Leave MCP configuration in place")
  .option("--skip-auth", "Keep the local auth session")
  .option("--remove-manifest", "Delete the repo manifest entry")
  .option("--remove-auth-handoff", "Delete platform-specific auth handoff files")
  .action(async (flags) => {
    const { runUninstall } = await import("./commands/uninstall.js");
    await runUninstall(flags);
  }),
    [
      "dops uninstall --platform codex",
      "dops uninstall --platform claude-code --remove-manifest --skip-auth",
    ],
  ),
  [
    `Supported platform ids: ${SUPPORTED_PLATFORM_IDS.join(", ")}`,
  ],
);

addExamples(
  program
  .command("update")
  .alias("self-update")
  .description("Update the dops CLI to the latest released binary")
  .option("--version <tag>", "Install a specific release tag, for example v0.1.0")
  .option("--install-dir <path>", "Override the binary install directory for this update")
  .action(async (flags) => {
    const { runUpdate } = await import("./commands/update.js");
    await runUpdate(flags);
  }),
  [
    "dops update",
    "dops update --version v0.1.0",
  ],
);

// Doctor
addExamples(
  program
  .command("doctor")
  .description("Diagnose local DecisionOps setup and suggest fixes")
  .option("--repo-path <path>", "Repository to inspect (defaults to current working tree)")
  .action(async (flags) => {
    const { runDoctor } = await import("./commands/doctor.js");
    await runDoctor(flags);
  }),
  [
    "dops doctor",
    "dops doctor --repo-path ~/projects/my-repo",
  ],
);

// Decision operations
const decisionsCommand = program.command("decisions").description("Work with decisions");
addExamples(decisionsCommand, [
  "dops decisions list",
  "dops decisions get dec_123",
  "dops decisions search auth onboarding",
  "dops decisions create",
]);

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
  .option("--repo-path <path>", "Repository to inspect (defaults to current working tree)")
  .action(async (id, flags) => {
    const { runDecisionsGet } = await import("./commands/decisions.js");
    await runDecisionsGet(id, flags);
  });

decisionsCommand
  .command("search <terms...>")
  .description("Search decisions by keywords")
  .option("--mode <mode>", "Search mode: semantic or keyword")
  .option("--repo-path <path>", "Repository to inspect (defaults to current working tree)")
  .action(async (terms, flags) => {
    const { runDecisionsSearch } = await import("./commands/decisions.js");
    await runDecisionsSearch(terms.join(" "), flags);
  });

decisionsCommand
  .command("create")
  .description("Create a new decision (interactive)")
  .option("--repo-path <path>", "Repository to write into (defaults to current working tree)")
  .action(async (flags) => {
    const { runDecisionsCreate } = await import("./commands/decisions.js");
    await runDecisionsCreate(flags);
  });

// Gate
addExamples(
  program
  .command("gate")
  .description("Run decision gate on current task")
  .option("--task <summary>", "Task summary")
  .option("--repo-path <path>", "Repository to inspect (defaults to current working tree)")
  .action(async (flags) => {
    const { runGate } = await import("./commands/gate.js");
    await runGate(flags);
  }),
  [
    "dops gate --task \"add oauth callback validation\"",
  ],
);

// Validate
addExamples(
  program
  .command("validate [id]")
  .description("Validate a decision against org constraints")
  .option("--repo-path <path>", "Repository to inspect (defaults to current working tree)")
  .action(async (id, flags) => {
    const { runValidate } = await import("./commands/validate.js");
    await runValidate(id, flags);
  }),
  [
    "dops validate",
    "dops validate dec_123",
  ],
);

// Publish
addExamples(
  program
  .command("publish <id>")
  .description("Publish a proposed decision (transition to accepted)")
  .option("--version <n>", "Expected version")
  .option("--repo-path <path>", "Repository to update (defaults to current working tree)")
  .action(async (id, flags) => {
    const { runPublish } = await import("./commands/publish.js");
    await runPublish(id, flags);
  }),
  [
    "dops publish dec_123",
    "dops publish dec_123 --version 7",
  ],
);

// Status / governance
addExamples(
  program
  .command("status")
  .description("Governance snapshot: coverage, health, drift, alerts")
  .option("--repo-path <path>", "Repository to inspect (defaults to current working tree)")
  .action(async (flags) => {
    const { runStatus } = await import("./commands/status.js");
    await runStatus(flags);
  }),
  [
    "dops status",
  ],
);

// Platform
const platformCommand = program.command("platform").description("Platform registry operations");
addExamples(platformCommand, [
  "dops platform list",
  "dops platform build --platform codex --output-dir build",
]);

platformCommand
  .command("list")
  .description("List supported platforms")
  .action(async () => {
    const { runPlatformList } = await import("./commands/platform.js");
    await runPlatformList();
  });

addExamples(
  platformCommand
  .command("build")
  .description("Build platform bundles")
  .option(
    "-p, --platform <id>",
    `Select a platform to build. Run 'dops platform list' for valid ids (${SUPPORTED_PLATFORM_IDS.join(", ")})`,
    collectValues,
    [],
  )
  .option("--output-dir <path>", "Directory to write generated bundles into")
  .option("--source-dir <path>", "Override the DecisionOps skill source bundle directory")
  .option("--skill-name <name>", "Override the generated skill directory name")
  .option("--server-name <name>", "Override the generated MCP server name")
  .option("--server-url <url>", "Override the generated MCP server URL")
  .action(async (flags) => {
    const { runPlatformBuild } = await import("./commands/platform.js");
    await runPlatformBuild(flags);
  }),
  [
    "dops platform build --platform codex --output-dir build",
    "dops platform build --platform claude-code --source-dir ./skill/decision-ops",
  ],
);

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
