#!/usr/bin/env bash
# Builds this fork into a single binary and installs it as ~/.local/bin/is, outside nvm.
# The binary carries its own Node, so changing the system Node version never removes it.
set -euo pipefail
cd "$(dirname "$0")"

PLATFORM="$(node -p 'process.platform + "-" + process.arch')"
BIN_DIR="$HOME/.local/bin"

echo "==> Instaluję zależności"
npm ci --no-audit --no-fund

echo "==> Kompiluję TypeScript"
npm run build

echo "==> Buduję binarkę dla $PLATFORM (pierwszy raz potrwa chwilę, pobiera Node do zaszycia w binarce)"
npm run package

BUILT="pkg/inshellisense-$PLATFORM"
if [ ! -f "$BUILT" ]; then
  echo "Build nie utworzył $BUILT"
  exit 1
fi

echo "==> Instaluję do $BIN_DIR"
mkdir -p "$BIN_DIR"
# remove first so macOS does not reuse the old binary's cached code signature and kill the new one
rm -f "$BIN_DIR/is"
cp "$BUILT" "$BIN_DIR/is"
chmod +x "$BIN_DIR/is"
ln -sf "$BIN_DIR/is" "$BIN_DIR/inshellisense"

if ! grep -qs '\.local/bin' "$HOME/.zshrc"; then
  perl -0pi -e '$_ = qq{export PATH="\$HOME/.local/bin:\$PATH"\n} . $_' "$HOME/.zshrc"
  echo "==> Dodałem ~/.local/bin do PATH na początku ~/.zshrc"
fi

echo "==> Odświeżam zasoby"
"$BIN_DIR/is" reinit || echo "is reinit się nie udał, otwórz nową kartę terminala i wpisz: is reinit"

if npm ls -g @microsoft/inshellisense >/dev/null 2>&1; then
  echo
  echo "Masz jeszcze wersję z npm, przypiętą do obecnego Node. Nie jest już potrzebna:"
  echo "  npm uninstall -g @microsoft/inshellisense"
fi

echo
echo "Gotowe. Otwórz nową kartę terminala."
