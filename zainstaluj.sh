#!/usr/bin/env bash
# Builds this fork into a single binary and swaps it in place of the one installed by
# `npm install -g @microsoft/inshellisense`. The original binary is kept next to it as *.orig.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v is >/dev/null 2>&1; then
  echo "Nie widzę komendy 'is'. Najpierw: npm install -g @microsoft/inshellisense"
  exit 1
fi

PLATFORM="$(node -p 'process.platform + "-" + process.arch')"
GLOBAL_ROOT="$(npm root -g)"
TARGET_DIR="$(node -e '
  const path = require("path");
  const base = path.join(process.argv[1], "@microsoft", "inshellisense");
  try {
    console.log(path.dirname(require.resolve(`@microsoft/inshellisense-${process.argv[2]}/package.json`, { paths: [base] })));
  } catch {
    process.exit(1);
  }
' "$GLOBAL_ROOT" "$PLATFORM")" || {
  echo "Nie znalazłem zainstalowanej paczki @microsoft/inshellisense-$PLATFORM w $GLOBAL_ROOT."
  echo "Ten skrypt obsługuje instalację przez npm (nie przez Homebrew)."
  exit 1
}
DEST="$TARGET_DIR/inshellisense-$PLATFORM"

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

if [ ! -f "$DEST.orig" ]; then
  cp "$DEST" "$DEST.orig"
  echo "==> Kopia oryginału: $DEST.orig"
fi
cp "$BUILT" "$DEST"
chmod +x "$DEST"

echo "==> Odświeżam zasoby"
is reinit

echo
echo "Gotowe. Otwórz nową kartę terminala."
