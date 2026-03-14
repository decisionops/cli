# dops

Repo-anchored CLI for working with decisions. Authenticate, bind a repository to a DecisionOps project, install AI agent skills, and manage decisions from the terminal.

![dops --help](assets/demo-help.gif)

## Install

**macOS / Linux**

```bash
curl -fsSL https://get.decisionops.dev/dops | sh
```

**Windows (PowerShell)**

```powershell
irm https://get.decisionops.dev/dops | iex
```

Both scripts download a precompiled binary to `~/.dops/bin` and add it to your shell PATH. Customize with environment variables:

| Variable | Default | Description |
|---|---|---|
| `DOPS_INSTALL_DIR` | `~/.dops/bin` | Where to install the binary |
| `DOPS_VERSION` | `latest` | Specific release tag (e.g. `v0.1.0`) |

## Quick start

```bash
# 1. Authenticate
dops login

# 2. Bind this repo to your DecisionOps project
cd your-repo
dops init --org-id <org> --project-id <project>

# 3. Install skill + MCP config for your editor
dops install --platform claude-code

# 4. Check everything is wired up
dops doctor

# 5. Start using decisions
dops gate --task "migrate from Postgres to CockroachDB"
dops decisions list --status accepted
```

### `dops init`

![dops init](assets/demo-init.gif)

### `dops doctor`

![dops doctor](assets/demo-doctor.gif)

## Commands

### Authentication

| Command | Description |
|---|---|
| `dops login` | Authenticate via browser OAuth or access token |
| `dops logout` | Revoke session and clear local credentials |
| `dops auth status` | Show current user, method, and token expiry |

### Repository setup

| Command | Description |
|---|---|
| `dops init` | Bind repo to a DecisionOps project (writes `.decisionops/manifest.toml`) |
| `dops install` | Install skill files + MCP config for chosen platforms |
| `dops uninstall` | Remove skill files, MCP entries, and optionally auth state |
| `dops doctor` | Diagnose auth, manifest, platforms, and connectivity |

### Decisions

| Command | Description |
|---|---|
| `dops decisions list` | List decisions with optional filters |
| `dops decisions get <id>` | Show full decision detail |
| `dops decisions search <terms>` | Search decisions by keywords |
| `dops decisions create` | Interactive decision creation |
| `dops gate` | Classify whether current task warrants a recorded decision |
| `dops validate [id]` | Validate a decision against org constraints |
| `dops publish <id>` | Transition a proposed decision to accepted |

### Governance

| Command | Description |
|---|---|
| `dops status` | Coverage, health, drift rate, and active alerts |

### Platforms

| Command | Description |
|---|---|
| `dops platform list` | List supported platforms and capabilities |
| `dops platform build` | Build platform-specific bundles |

## Command reference

### `dops login`

Authenticate this machine with DecisionOps.

```bash
dops login              # interactive browser OAuth (default)
dops login --web        # force browser-based PKCE
dops login --with-token # paste an access token (CI / headless)
dops login --clear      # remove saved credentials
```

Key flags:

| Flag | Description |
|---|---|
| `--web` | Use browser-based PKCE login |
| `--with-token` | Save a raw access token |
| `--token <token>` | Token value (use with `--with-token`) |
| `--no-browser` | Don't auto-launch browser |
| `--clear` | Remove saved login state |
| `--api-base-url <url>` | Custom API endpoint |
| `--issuer-url <url>` | Custom OAuth issuer |

### `dops init`

Bind the current repo to a DecisionOps org and project.

```bash
dops init --org-id acme --project-id backend --repo-ref acme/backend
dops init --allow-placeholders   # local prototyping without real IDs
```

Creates `.decisionops/manifest.toml` with org/project binding, repo reference, and MCP server config.

Key flags:

| Flag | Description |
|---|---|
| `--org-id <id>` | Organization ID |
| `--project-id <id>` | Project ID |
| `--repo-ref <ref>` | GitHub repo reference (`owner/repo`) |
| `--default-branch <branch>` | Default branch (auto-detected from git) |
| `--allow-placeholders` | Use placeholder values for local prototyping |
| `--server-name <name>` | MCP server name (default: `decision-ops`) |
| `--server-url <url>` | MCP server URL |

### `dops install`

Install the Decision Ops skill and MCP configuration for one or more platforms.

```bash
dops install                          # interactive platform selection
dops install -p claude-code           # specific platform
dops install -p claude-code -p cursor # multiple platforms
dops install --skip-mcp               # skill files only
```

Key flags:

| Flag | Description |
|---|---|
| `-p, --platform <id>` | Platform to install (repeatable) |
| `-y, --yes` | Accept defaults without prompting |
| `--skip-manifest` | Don't write manifest |
| `--skip-skill` | Don't install skill files |
| `--skip-mcp` | Don't configure MCP server |
| `--output-dir <path>` | Build output directory |

Also accepts all `init` flags (`--org-id`, `--project-id`, etc.) to configure the manifest in one step.

### `dops uninstall`

Remove installed skill files, MCP config entries, and optionally auth state.

```bash
dops uninstall -p claude-code
dops uninstall -p claude-code --remove-manifest --skip-auth
```

| Flag | Description |
|---|---|
| `-p, --platform <id>` | Platform to clean up (repeatable) |
| `--skip-skill` | Keep skill files |
| `--skip-mcp` | Keep MCP config |
| `--skip-auth` | Don't revoke auth |
| `--remove-manifest` | Also delete `.decisionops/manifest.toml` |

### `dops doctor`

Run diagnostics on the local DecisionOps setup.

```bash
dops doctor
dops doctor --repo-path /path/to/repo
```

Checks: authentication state, git repo detection, manifest presence and required fields, platform installation status (skill + MCP for each supported platform).

### `dops decisions list`

```bash
dops decisions list
dops decisions list --status proposed --type technical --limit 10
```

| Flag | Description |
|---|---|
| `--status <status>` | Filter: `proposed`, `accepted`, `deprecated`, `superseded` |
| `--type <type>` | Filter: `technical`, `product`, `business`, `governance` |
| `--limit <n>` | Max results (default: 20) |

### `dops decisions get <id>`

```bash
dops decisions get dec_abc123
```

Displays: title, status, type, version, context, outcome, options with pros/cons, consequences, and timestamps.

### `dops decisions search <terms>`

```bash
dops decisions search "database migration"
dops decisions search "auth strategy" --mode semantic
```

| Flag | Description |
|---|---|
| `--mode <mode>` | `semantic` or `keyword` (default) |

### `dops decisions create`

Interactive multi-step flow: title, type (technical/product/business/governance), and context.

```bash
dops decisions create
```

### `dops gate`

Classify whether the current task warrants a recorded decision.

```bash
dops gate --task "switch from REST to gRPC for internal services"
dops gate   # prompts for task summary interactively
```

Output includes: recordable (yes/no), confidence percentage, reasoning, and suggested decision type.

### `dops validate [id]`

```bash
dops validate dec_abc123
```

Validates a decision against organization constraints. Reports errors and warnings.

### `dops publish <id>`

```bash
dops publish dec_abc123
dops publish dec_abc123 --version 2   # optimistic concurrency check
```

Transitions a proposed decision to accepted.

### `dops status`

```bash
dops status
```

Governance snapshot: total decisions, coverage %, health %, drift rate, status breakdown, and active alerts.

## Configuration

### `.decisionops/manifest.toml`

Created by `dops init` or `dops install`. Binds a repository to a DecisionOps project.

```toml
[decisionops]
org_id = "acme"
project_id = "backend"
repo_ref = "acme/backend"
default_branch = "main"

[mcp]
server_name = "decision-ops"
server_url = "https://api.aidecisionops.com/mcp"
```

### `~/.decisionops/auth.json`

Created by `dops login`. Stores OAuth tokens or raw access tokens. Managed automatically — don't edit manually.

## Supported platforms

| Platform | Skill | MCP | Config path |
|---|---|---|---|
| Claude Code | yes | yes | `.mcp.json` |
| VS Code | no | yes | `.vscode/mcp.json` |
| Cursor | yes | yes | `.cursor/mcp.json` |
| Codex | yes | yes | `codex.toml` |
| Antigravity | yes | yes | `.antigravity/mcp.json` |

## Environment variables

| Variable | Description |
|---|---|
| `NO_COLOR` | Disable colored output |
| `FORCE_COLOR` | Force colored output |

## Development

Requires [Bun](https://bun.sh) runtime.

```bash
bun install
bun run src/cli.ts --help         # run in dev mode
bun run typecheck                 # type check
bun test                          # run tests
bun run build                     # compile standalone binary
```

### Cross-platform binaries

```bash
bun build src/cli.ts --compile --target=bun-darwin-arm64 --outfile dist/dops-darwin-arm64
bun build src/cli.ts --compile --target=bun-darwin-x64 --outfile dist/dops-darwin-x64
bun build src/cli.ts --compile --target=bun-linux-x64 --outfile dist/dops-linux-x64
bun build src/cli.ts --compile --target=bun-linux-arm64 --outfile dist/dops-linux-arm64
bun build src/cli.ts --compile --target=bun-windows-x64 --outfile dist/dops-windows-x64.exe
```

## License

Apache-2.0
