#!/bin/sh
set -e

# dops installer for macOS/Linux
# Usage: curl -fsSL https://get.aidecisionops.com/dops | sh

INSTALL_DIR="${DOPS_INSTALL_DIR:-$HOME/.dops/bin}"
REPO="decisionops/cli"
VERSION="${DOPS_VERSION:-latest}"
INSTALL_PATH="${INSTALL_DIR}/dops"

append_path_entry() {
  RC="$1"
  LINE="export PATH=\"${INSTALL_DIR}:\$PATH\""
  if [ -f "$RC" ] && grep -Fqs "$LINE" "$RC"; then
    return
  fi
  echo "" >> "$RC"
  echo "# dops" >> "$RC"
  echo "$LINE" >> "$RC"
  echo "Added ${INSTALL_DIR} to PATH in ${RC}"
}

print_post_install_notes() {
  RELEASE_VERSION="$1"
  INSTALLED_VERSION="$("$INSTALL_PATH" --version 2>/dev/null || true)"
  if [ -z "$INSTALLED_VERSION" ]; then
    INSTALLED_VERSION="${RELEASE_VERSION:-unknown}"
  fi
  CURRENT_DOPS="$(command -v dops 2>/dev/null || true)"

  echo "Installed version: ${INSTALLED_VERSION}"
  if [ -n "$CURRENT_DOPS" ] && [ "$CURRENT_DOPS" != "$INSTALL_PATH" ]; then
    echo ""
    echo "Note: your current shell resolves dops to ${CURRENT_DOPS}"
    echo "The newly installed binary is at ${INSTALL_PATH}"
    echo "Run '${INSTALL_PATH} --version' now, or start a new shell to pick up the updated PATH."
  fi
}

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
  echo "${OS}-${ARCH}"
}

main() {
  PLATFORM=$(detect_platform)
  BINARY="dops-${PLATFORM}"

  if [ "$VERSION" = "latest" ]; then
    DOWNLOAD_URL="https://github.com/${REPO}/releases/latest/download/${BINARY}"
  else
    DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${VERSION}/${BINARY}"
  fi

  echo "Installing dops for ${PLATFORM}..."
  echo "Downloading ${BINARY} from ${DOWNLOAD_URL}..."
  mkdir -p "$INSTALL_DIR"
  TMP_PATH="$(mktemp "${INSTALL_DIR}/.dops.XXXXXX")"
  trap 'rm -f "$TMP_PATH"' EXIT INT TERM
  FINAL_URL="$(curl -fsSL --progress-bar -w '%{url_effective}' "$DOWNLOAD_URL" -o "$TMP_PATH")"
  RESOLVED_VERSION="$(printf '%s' "$FINAL_URL" | sed -n 's#^.*/download/\([^/]*\)/.*#\1#p')"
  chmod +x "$TMP_PATH"
  mv "$TMP_PATH" "$INSTALL_PATH"
  trap - EXIT INT TERM

  # Add to PATH if needed
  case ":$PATH:" in
    *":${INSTALL_DIR}:"*) ;;
    *)
      SHELL_NAME="$(basename "$SHELL")"
      case "$SHELL_NAME" in
        zsh) RC="$HOME/.zshrc" ;;
        bash) RC="$HOME/.bashrc" ;;
        fish) RC="$HOME/.config/fish/config.fish" ;;
        *) RC="" ;;
      esac
      if [ -n "$RC" ]; then
        append_path_entry "$RC"
      else
        echo "Add ${INSTALL_DIR} to your PATH manually."
      fi
      ;;
  esac

  echo "dops installed to ${INSTALL_PATH}"
  print_post_install_notes "$RESOLVED_VERSION"
  echo "Congrats on your decision to install the dops CLI!"
  echo "Run 'dops --help' to get started."
}

main
