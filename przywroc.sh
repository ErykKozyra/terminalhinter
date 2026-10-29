#!/usr/bin/env bash
# Puts back the original Microsoft binary saved by zainstaluj.sh.
set -euo pipefail

PLATFORM="$(node -p 'process.platform + "-" + process.arch')"
GLOBAL_ROOT="$(npm root -g)"
TARGET_DIR="$(node -e '
  const path = require("path");
  const base = path.join(process.argv[1], "@microsoft", "inshellisense");
  console.log(path.dirname(require.resolve(`@microsoft/inshellisense-${process.argv[2]}/package.json`, { paths: [base] })));
' "$GLOBAL_ROOT" "$PLATFORM")"
DEST="$TARGET_DIR/inshellisense-$PLATFORM"

if [ ! -f "$DEST.orig" ]; then
  echo "Brak kopii $DEST.orig, nie ma czego przywracać."
  exit 1
fi
mv "$DEST.orig" "$DEST"
is reinit
echo "Przywrócono oryginalną wersję. Otwórz nową kartę terminala."
