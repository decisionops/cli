# dops

`dops` is the DecisionOps CLI for wiring a repo to DecisionOps, installing editor integrations, and working with decisions from the terminal.

If you are a developer evaluating this tool, the important questions are:

1. What will it change in my repo?
2. What will it change in my editor config?
3. How do I know it worked?
4. How do I undo it?

This README is organized around those questions.

## What dops does

`dops` helps with three jobs:

- Bind a git repo to a DecisionOps org/project.
- Install the DecisionOps skill and MCP configuration for your editor or coding agent.
- Query and manage decisions from the terminal.

## Install

### Hosted installer

**macOS / Linux**

```bash
curl -fsSL https://get.aidecisionops.com/dops | sh
```

**Windows (PowerShell)**

```powershell
irm https://get.aidecisionops.com/dops.ps1 | iex
```

The hosted installer downloads the latest released `dops` binary from GitHub Releases into `~/.dops/bin` and adds that directory to your `PATH` when needed.

## Update

If `dops` is already installed, update it in place with:

```bash
dops update
```

Pin to a specific release:

```bash
dops update --version v0.1.11
```

This re-runs the same hosted installer flow used for first-time installation and writes the updated binary to the existing install directory unless you pass `--install-dir`.

### From source

Requires Python 3.13+.

```bash
git clone <repo-url>
cd cli
python3 -m venv .venv
. .venv/bin/activate
pip install -e .
```

Run directly with `python -m dops` or the installed `dops` console script.

| Variable | Default | Description |
|---|---|---|
| `DOPS_INSTALL_DIR` | `~/.dops/bin` | Install location for the binary |
| `DOPS_VERSION` | `latest` | Specific release tag such as `v0.1.11` |

## Five-minute setup

```bash
# 1. Authenticate this machine
dops login

# 2. Move into the repo you want to bind
cd your-repo

# 3. Create the repo binding
dops init --org-id <org_id> --project-id <project_id>

# 4. Install your editor integration
dops install --platform codex

# 5. Verify everything is in place
dops doctor
```

When this is working, you should have:

- `.decisionops/manifest.toml` in the repo
- a DecisionOps skill installed for your selected platform
- an MCP config entry pointing at the DecisionOps MCP server
- `dops doctor` showing the repo binding and platform status

### Important: CLI auth and IDE MCP auth are separate

`dops login` authenticates the **CLI** only. Each IDE authenticates **separately** via its own browser OAuth flow when you first invoke an MCP tool. After running `dops install`, you still need to:

1. **Enable the MCP server** in your IDE settings (e.g., Cursor: **Settings → Tools & MCP** toggle).
2. **Complete the browser OAuth flow** — invoke any DecisionOps MCP tool from the IDE, complete sign-in and consent in the browser, then retry the tool call.
3. **Approve MCP tool invocations** when the IDE prompts you (e.g., Claude Code requires manual approval per tool call).

There is no API key or token-based alternative for IDE MCP authentication.

## What gets written

`dops` writes a small number of files so the integration is inspectable and reversible.

### In your repo

| Path | Written by | Purpose |
|---|---|---|
| `.decisionops/manifest.toml` | `dops init`, `dops install` | Binds the repo to an org/project and records MCP server details |
| `.decisionops/auth-handoff.toml` | `dops install` | Tells the editor or MCP client how to complete the first interactive auth handoff |
| `.mcp.json` | `dops install -p claude-code` | Claude Code project MCP config |
| `.cursor/mcp.json` | `dops install -p cursor` | Cursor project MCP config |
| `.vscode/mcp.json` | `dops install -p vscode` | VS Code project MCP config |

### In your user config

| Path | Written by | Purpose |
|---|---|---|
| `~/.decisionops/auth.json` | `dops login` | Stores CLI auth state |
| `~/.codex/skills/decision-ops` | `dops install -p codex` | Installs the DecisionOps skill for Codex |
| `~/.codex/config.toml` | `dops install -p codex` | Adds the DecisionOps MCP server to Codex |
| `~/.claude/skills/decision-ops` | `dops install -p claude-code` | Installs the DecisionOps skill for Claude Code |
| `~/.cursor/skills/decision-ops` | `dops install -p cursor` | Installs the DecisionOps skill for Cursor |
| `~/.antigravity/skills/decision-ops` | `dops install -p antigravity` | Installs the DecisionOps skill for Antigravity |

## What success looks like

### Repo binding

`dops init` should leave a manifest in the repo.

![dops init](assets/demo-init.gif)

Example manifest written by the CLI:

```toml
version = 1
org_id = "acme"
project_id = "backend"
repo_ref = "acme/backend"
default_branch = "main"
mcp_server_name = "decision-ops-mcp"
mcp_server_url = "https://api.aidecisionops.com/mcp"
```

### Setup verification

`dops doctor` is the quickest way to verify auth, repo binding, and platform installation status.

![dops doctor](assets/demo-doctor.gif)

Use it whenever you are unsure whether the CLI, manifest, or editor integration is the thing that is broken.

## Supported platforms

| Platform | Skill install | MCP config | Default MCP location |
|---|---|---|---|
| Claude Code | yes | yes | `<repo>/.mcp.json` |
| VS Code | no | yes | `<repo>/.vscode/mcp.json` |
| Cursor | yes | yes | `<repo>/.cursor/mcp.json` |
| Codex | yes | yes | `~/.codex/config.toml` |
| Antigravity | yes | yes | platform-specific user config via `ANTIGRAVITY_MCP_CONFIG_PATH` |

## Common workflows

### Authenticate

```bash
dops login
dops login --web
dops login --with-token
dops login --with-token --token dop_...
dops logout
dops auth status
```

### Bind a repo

```bash
dops init --org-id acme --project-id backend --repo-ref acme/backend
```

For local prototyping without live IDs:

```bash
dops init --allow-placeholders
```

### Install an editor integration

```bash
dops install --platform codex
dops install --platform claude-code
dops install --platform cursor
dops install --platform vscode
```

Install multiple targets at once:

```bash
dops install --platform codex --platform claude-code
```

Only write the skill:

```bash
dops install --platform codex --skip-mcp
```

Only write the MCP config:

```bash
dops install --platform codex --skip-skill
```

### Verify or troubleshoot setup

```bash
dops doctor
dops doctor --repo-path /path/to/repo
```

### Remove the integration

```bash
dops uninstall --platform codex --skip-auth
dops uninstall --platform claude-code --remove-manifest --skip-auth
```

## Working with decisions

Once the repo is bound and auth is set up, you can work with decisions directly from the terminal.

```bash
dops gate --task "switch from REST to gRPC for internal services"
dops decisions list --status proposed
dops decisions get dec_abc123
dops decisions search "database migration"
dops decisions create
dops validate dec_abc123
dops publish dec_abc123
dops status
```

## Commands

### Authentication

| Command | Description |
|---|---|
| `dops login` | Authenticate via browser OAuth or raw token |
| `dops logout` | Remove the current CLI session |
| `dops auth status` | Show the saved auth session |

### Repo and platform setup

| Command | Description |
|---|---|
| `dops init` | Write `.decisionops/manifest.toml` for the current repo |
| `dops install` | Install skill files and MCP config for one or more platforms |
| `dops update` | Update the installed CLI binary |
| `dops uninstall` | Remove installed skill files and MCP config |
| `dops doctor` | Diagnose auth, manifest, and platform state |
| `dops platform list` | Show supported platforms |
| `dops platform build` | Build platform bundles without installing them |

### Decisions and governance

| Command | Description |
|---|---|
| `dops gate` | Classify whether a task should become a recorded decision |
| `dops decisions list` | List decisions |
| `dops decisions get <id>` | Show one decision |
| `dops decisions search <terms>` | Search decisions |
| `dops decisions create` | Create a new decision interactively |
| `dops validate [id]` | Validate a decision |
| `dops publish <id>` | Transition a decision to accepted |
| `dops status` | Show governance snapshot and alerts |

## Configuration reference

### `.decisionops/manifest.toml`

This file is flat TOML, not nested sections.

```toml
version = 1
org_id = "acme"
project_id = "backend"
repo_ref = "acme/backend"
default_branch = "main"
mcp_server_name = "decision-ops-mcp"
mcp_server_url = "https://api.aidecisionops.com/mcp"
```

Optional field:

```toml
repo_id = "repo_123"
```

### `~/.decisionops/auth.json`

Written by `dops login`. This stores CLI auth state and is managed by the CLI.

### Environment variables

| Variable | Description |
|---|---|
| `NO_COLOR` | Disable colored output |
| `FORCE_COLOR` | Force colored output |
| `DECISIONOPS_HOME` | Override the default DecisionOps home directory |
| `CODEX_HOME` | Override the Codex config root used for skill/MCP installation |
| `CODEX_CONFIG_PATH` | Override the Codex MCP config path |
| `CLAUDE_SKILLS_DIR` | Override Claude Code skill install location |
| `CLAUDE_MCP_CONFIG_PATH` | Override Claude Code MCP config path |
| `CURSOR_SKILLS_DIR` | Override Cursor skill install location |
| `CURSOR_MCP_CONFIG_PATH` | Override Cursor MCP config path |
| `VSCODE_MCP_CONFIG_PATH` | Override VS Code MCP config path |
| `ANTIGRAVITY_SKILLS_DIR` | Override Antigravity skill install location |
| `ANTIGRAVITY_MCP_CONFIG_PATH` | Override Antigravity MCP config path |

## Development

Requires Python 3.13+.

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -e .
python -m dops --help
python -m unittest discover -s tests -v
```

### Cross-platform binaries

```bash
pip install pyinstaller
pyinstaller --onefile --name dops dops_bootstrap.py
```

## License

Apache-2.0
