#!/bin/sh
set -e

# dops installer for macOS/Linux
# Usage: curl -fsSL https://get.aidecisionops.com/dops | sh

INSTALL_DIR="${DOPS_INSTALL_DIR:-$HOME/.dops/bin}"
REPO="decisionops/cli"
VERSION="${DOPS_VERSION:-latest}"

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
  curl -fL --progress-bar "$DOWNLOAD_URL" -o "${INSTALL_DIR}/dops"
  chmod +x "${INSTALL_DIR}/dops"

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
        echo "" >> "$RC"
        echo "# dops" >> "$RC"
        echo "export PATH=\"${INSTALL_DIR}:\$PATH\"" >> "$RC"
        echo "Added ${INSTALL_DIR} to PATH in ${RC}"
      else
        echo "Add ${INSTALL_DIR} to your PATH manually."
      fi
      ;;
  esac

  echo "dops installed to ${INSTALL_DIR}/dops"
  echo "Congrats on your decision to install the dops CLI!"
  echo "Run 'dops --help' to get started."
}

main
