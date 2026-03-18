from __future__ import annotations

DEFAULT_INSTALL_BASE_URL = "https://get.aidecisionops.com"
DEFAULT_RELEASE_REPO_SLUG = "decisionops/cli"
SHELL_INSTALL_PATH = "/dops"
POWERSHELL_INSTALL_PATH = "/dops.ps1"
SHELL_INSTALLER_URL = f"{DEFAULT_INSTALL_BASE_URL}{SHELL_INSTALL_PATH}"
POWERSHELL_INSTALLER_URL = f"{DEFAULT_INSTALL_BASE_URL}{POWERSHELL_INSTALL_PATH}"


def _normalize_base_url(value: str) -> str:
    return value.rstrip("/")


def render_shell_installer(install_base_url: str = DEFAULT_INSTALL_BASE_URL, release_repo_slug: str = DEFAULT_RELEASE_REPO_SLUG) -> str:
    install_base_url = _normalize_base_url(install_base_url)
    return f"""#!/bin/sh
set -e

# dops installer for macOS/Linux
# Usage: curl -fsSL {install_base_url}{SHELL_INSTALL_PATH} | sh

INSTALL_DIR="${{DOPS_INSTALL_DIR:-$HOME/.dops/bin}}"
REPO="{release_repo_slug}"
VERSION="${{DOPS_VERSION:-latest}}"

detect_platform() {{
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
  echo "${{OS}}-${{ARCH}}"
}}

main() {{
  PLATFORM=$(detect_platform)
  BINARY="dops-${{PLATFORM}}"

  if [ "$VERSION" = "latest" ]; then
    DOWNLOAD_URL="https://github.com/${{REPO}}/releases/latest/download/${{BINARY}}"
  else
    DOWNLOAD_URL="https://github.com/${{REPO}}/releases/download/${{VERSION}}/${{BINARY}}"
  fi

  echo "Installing dops for ${{PLATFORM}}..."
  echo "Downloading ${{BINARY}} from ${{DOWNLOAD_URL}}..."
  mkdir -p "$INSTALL_DIR"
  curl -fL --progress-bar "$DOWNLOAD_URL" -o "${{INSTALL_DIR}}/dops"
  chmod +x "${{INSTALL_DIR}}/dops"

  # Add to PATH if needed
  case ":$PATH:" in
    *":${{INSTALL_DIR}}:"*) ;;
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
        echo "export PATH=\\"${{INSTALL_DIR}}:\\$PATH\\"" >> "$RC"
        echo "Added ${{INSTALL_DIR}} to PATH in ${{RC}}"
      else
        echo "Add ${{INSTALL_DIR}} to your PATH manually."
      fi
      ;;
  esac

  echo "dops installed to ${{INSTALL_DIR}}/dops"
  echo "Congrats on your decision to install the dops CLI!"
  echo "Run 'dops --help' to get started."
}}

main
"""


def render_powershell_installer(
    install_base_url: str = DEFAULT_INSTALL_BASE_URL,
    release_repo_slug: str = DEFAULT_RELEASE_REPO_SLUG,
) -> str:
    install_base_url = _normalize_base_url(install_base_url)
    return f"""# dops installer for Windows
# Usage: irm {install_base_url}{POWERSHELL_INSTALL_PATH} | iex

$ErrorActionPreference = "Stop"

$InstallDir = if ($env:DOPS_INSTALL_DIR) {{ $env:DOPS_INSTALL_DIR }} else {{ "$env:USERPROFILE\\.dops\\bin" }}
$Repo = "{release_repo_slug}"
$Version = if ($env:DOPS_VERSION) {{ $env:DOPS_VERSION }} else {{ "latest" }}
$Binary = "dops-windows-x64.exe"

if ($Version -eq "latest") {{
  $DownloadUrl = "https://github.com/$Repo/releases/latest/download/$Binary"
}} else {{
  $DownloadUrl = "https://github.com/$Repo/releases/download/$Version/$Binary"
}}

Write-Host "Installing dops for Windows..."
Write-Host "Downloading $Binary from $DownloadUrl..."
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Invoke-WebRequest -Uri $DownloadUrl -OutFile "$InstallDir\\dops.exe" -UseBasicParsing

# Add to PATH if needed
$currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($currentPath -notlike "*$InstallDir*") {{
  [Environment]::SetEnvironmentVariable("Path", "$InstallDir;$currentPath", "User")
  Write-Host "Added $InstallDir to user PATH."
}}

Write-Host "dops installed to $InstallDir\\dops.exe"
Write-Host "Congrats on your decision to install the dops CLI!"
Write-Host "Run 'dops --help' to get started (restart terminal for PATH changes)."
"""
