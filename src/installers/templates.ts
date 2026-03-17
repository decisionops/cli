export const DEFAULT_INSTALL_BASE_URL = "https://get.aidecisionops.com";
export const DEFAULT_RELEASE_REPO_SLUG = "decisionops/cli";
export const SHELL_INSTALL_PATH = "/dops";
export const POWERSHELL_INSTALL_PATH = "/dops.ps1";
export const SHELL_INSTALLER_URL = `${DEFAULT_INSTALL_BASE_URL}${SHELL_INSTALL_PATH}`;
export const POWERSHELL_INSTALLER_URL = `${DEFAULT_INSTALL_BASE_URL}${POWERSHELL_INSTALL_PATH}`;

type InstallerTemplateOptions = {
  installBaseUrl?: string;
  releaseRepoSlug?: string;
};

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

export function renderShellInstaller(options: InstallerTemplateOptions = {}): string {
  const installBaseUrl = normalizeBaseUrl(options.installBaseUrl ?? DEFAULT_INSTALL_BASE_URL);
  const releaseRepoSlug = options.releaseRepoSlug ?? DEFAULT_RELEASE_REPO_SLUG;

  return `#!/bin/sh
set -e

# dops installer for macOS/Linux
# Usage: curl -fsSL ${installBaseUrl}${SHELL_INSTALL_PATH} | sh

INSTALL_DIR="\${DOPS_INSTALL_DIR:-$HOME/.dops/bin}"
REPO="${releaseRepoSlug}"
VERSION="\${DOPS_VERSION:-latest}"

detect_platform() {
  OS="$(uname -s)"
  ARCH="$(uname -m)"
  case "$OS" in
    Darwin) OS="darwin" ;;
    Linux) OS="linux" ;;
    *) echo "Unsupported OS: $OS" >&2; exit 1 ;;
  esac
  case "$ARCH" in
    x86_64|amd64) ARCH="x64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
  esac
  echo "\${OS}-\${ARCH}"
}

main() {
  PLATFORM=$(detect_platform)
  BINARY="dops-\${PLATFORM}"

  if [ "$VERSION" = "latest" ]; then
    DOWNLOAD_URL="https://github.com/\${REPO}/releases/latest/download/\${BINARY}"
  else
    DOWNLOAD_URL="https://github.com/\${REPO}/releases/download/\${VERSION}/\${BINARY}"
  fi

  echo "Installing dops for \${PLATFORM}..."
  mkdir -p "$INSTALL_DIR"
  curl -fsSL "$DOWNLOAD_URL" -o "\${INSTALL_DIR}/dops"
  chmod +x "\${INSTALL_DIR}/dops"

  # Add to PATH if needed
  case ":$PATH:" in
    *":\${INSTALL_DIR}:"*) ;;
    *)
      SHELL_NAME="$(basename "$SHELL")"
      case "$SHELL_NAME" in
        zsh) RC="$HOME/.zshrc" ;;
        bash) RC="$HOME/.bashrc" ;;
        fish) RC="$HOME/.config/fish/config.fish" ;;
        *) RC="" ;;
      esac
      if [ -n "$RC" ]; then
        echo "" >> "$RC"
        echo "# dops" >> "$RC"
        echo "export PATH=\\"\${INSTALL_DIR}:\\$PATH\\"" >> "$RC"
        echo "Added \${INSTALL_DIR} to PATH in \${RC}"
      else
        echo "Add \${INSTALL_DIR} to your PATH manually."
      fi
      ;;
  esac

  echo "dops installed to \${INSTALL_DIR}/dops"
  echo "Run 'dops --help' to get started."
}

main
`;
}

export function renderPowerShellInstaller(options: InstallerTemplateOptions = {}): string {
  const installBaseUrl = normalizeBaseUrl(options.installBaseUrl ?? DEFAULT_INSTALL_BASE_URL);
  const releaseRepoSlug = options.releaseRepoSlug ?? DEFAULT_RELEASE_REPO_SLUG;

  return `# dops installer for Windows
# Usage: irm ${installBaseUrl}${POWERSHELL_INSTALL_PATH} | iex

$ErrorActionPreference = "Stop"

$InstallDir = if ($env:DOPS_INSTALL_DIR) { $env:DOPS_INSTALL_DIR } else { "$env:USERPROFILE\\.dops\\bin" }
$Repo = "${releaseRepoSlug}"
$Version = if ($env:DOPS_VERSION) { $env:DOPS_VERSION } else { "latest" }
$Binary = "dops-windows-x64.exe"

if ($Version -eq "latest") {
  $DownloadUrl = "https://github.com/$Repo/releases/latest/download/$Binary"
} else {
  $DownloadUrl = "https://github.com/$Repo/releases/download/$Version/$Binary"
}

Write-Host "Installing dops for Windows..."
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Invoke-WebRequest -Uri $DownloadUrl -OutFile "$InstallDir\\dops.exe" -UseBasicParsing

# Add to PATH if needed
$currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($currentPath -notlike "*$InstallDir*") {
  [Environment]::SetEnvironmentVariable("Path", "$InstallDir;$currentPath", "User")
  Write-Host "Added $InstallDir to user PATH."
}

Write-Host "dops installed to $InstallDir\\dops.exe"
Write-Host "Run 'dops --help' to get started (restart terminal for PATH changes)."
`;
}
