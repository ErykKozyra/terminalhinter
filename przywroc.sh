#!/usr/bin/env bash
# Removes the fork's binary from ~/.local/bin. The original from Microsoft can be installed again with npm.
set -euo pipefail

BIN_DIR="$HOME/.local/bin"
rm -f "$BIN_DIR/is" "$BIN_DIR/inshellisense"
echo "Usunięto $BIN_DIR/is."
echo "Oryginalna wersja od Microsoftu: npm install -g @microsoft/inshellisense && is reinit"
echo "Bez żadnej wersji linijka inshellisense w ~/.zshrc po prostu nic nie robi."
