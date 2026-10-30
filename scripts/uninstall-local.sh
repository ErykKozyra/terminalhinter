#!/usr/bin/env bash
# Removes terminalhinter installed by install-from-source.sh: the binary, its resources and the ~/.zshrc block.
# Your settings file (~/.terminalhinterrc) is kept.
set -euo pipefail

BIN_DIR="$HOME/.local/bin"
rm -f "$BIN_DIR/thint" "$BIN_DIR/terminalhinter"
rm -rf "$HOME/.local/share/terminalhinter"

ZSHRC="$HOME/.zshrc"
if [ -f "$ZSHRC" ] && grep -q '^# >>> terminalhinter >>>' "$ZSHRC"; then
  cp "$ZSHRC" "$ZSHRC.before-terminalhinter-uninstall"
  perl -0pi -e 's/^# >>> terminalhinter >>>\n.*?^# <<< terminalhinter <<<\n\n?//msg' "$ZSHRC"
  echo "Removed the terminalhinter block from ~/.zshrc (backup: ~/.zshrc.before-terminalhinter-uninstall)"
fi

echo "terminalhinter removed. Settings in ~/.terminalhinterrc were kept; delete them yourself if you like."
echo "Open a new terminal tab."
