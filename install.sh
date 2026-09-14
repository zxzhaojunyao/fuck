#!/usr/bin/env bash
# FUCK installer — download the platform binary from GitHub Releases into ~/.fuck/bin
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/zxzhaojunyao/fuck/main/install.sh | bash
#   FUCK_VERSION=v1.1.2 bash install.sh        # pin a specific version
set -euo pipefail

REPO="${FUCK_REPO:-zxzhaojunyao/fuck}"
INSTALL_DIR="${FUCK_BIN_DIR:-$HOME/.fuck/bin}"

# ---- detect platform ----
os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"

bin_name="fuck"
case "$os" in
  linux)
    platform="linux"
    ;;
  darwin)
    platform="darwin"
    ;;
  mingw*|msys*|cygwin*)
    platform="windows"
    bin_name="fuck.exe"
    ;;
  *)
    echo "error: unsupported OS: $os" >&2
    exit 1
    ;;
esac

case "$arch" in
  x86_64|amd64) arch="x64" ;;
  aarch64|arm64) arch="arm64" ;;
  *) echo "error: unsupported architecture: $arch" >&2; exit 1 ;;
esac

# ---- resolve download url ----
if [ "$platform" = "windows" ]; then
  asset="fuck-windows-x64.zip"
else
  asset="fuck-${platform}-${arch}.tar.gz"
fi

if [ -n "${FUCK_VERSION:-}" ]; then
  url="https://github.com/${REPO}/releases/download/${FUCK_VERSION}/${asset}"
  version="$FUCK_VERSION"
else
  # /releases/latest/download/ always redirects to the newest published release
  url="https://github.com/${REPO}/releases/latest/download/${asset}"
  version="latest"
fi

echo "FUCK installer"
echo "  platform : ${platform}/${arch}"
echo "  asset    : ${asset}"
echo "  target   : ${INSTALL_DIR}/${bin_name}"
echo

# ---- download ----
mkdir -p "$INSTALL_DIR"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

if command -v curl >/dev/null 2>&1; then
  curl -fSL --progress-bar "$url" -o "$tmp"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$tmp" "$url"
else
  echo "error: need curl or wget" >&2
  exit 1
fi

# ---- unpack ----
# git-bash ships bsdtar (reads zip); Linux tar reads tar.gz natively
if [ "$platform" = "windows" ]; then
  tar -xf "$tmp" -C "$INSTALL_DIR"
else
  tar -xzf "$tmp" -C "$INSTALL_DIR"
fi
chmod 755 "${INSTALL_DIR}/${bin_name}" 2>/dev/null || true

# macOS: strip the quarantine xattr so Gatekeeper doesn't block the binary
if [ "$platform" = "darwin" ]; then
  xattr -dr com.apple.quarantine "${INSTALL_DIR}/${bin_name}" 2>/dev/null || true
fi

# version marker (kept in sync with the npm postinstall convention)
[ "$version" != "latest" ] && echo "$version" > "${INSTALL_DIR}/.version" || true

echo
echo "installed: ${INSTALL_DIR}/${bin_name}"

# ---- PATH check ----
case ":${PATH}:" in
  *":${INSTALL_DIR}:"*)
    echo "PATH already contains ${INSTALL_DIR} — you're set."
    echo
    echo "run: fuck"
    exit 0
    ;;
esac

line="export PATH=\"${INSTALL_DIR}:\$PATH\""
added=""
for rc in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.profile"; do
  if [ -f "$rc" ] && ! grep -qF "$INSTALL_DIR" "$rc" 2>/dev/null; then
    printf '\n# FUCK agent\n%s\n' "$line" >> "$rc"
    added="${added} ${rc}"
  fi
done

if [ -n "$added" ]; then
  echo "added PATH export to:${added}"
  echo "restart your shell (or: source ~/.zshrc), then run: fuck"
else
  echo "note: ${INSTALL_DIR} is not in your PATH."
  echo "add it manually:"
  echo "  ${line}"
fi
