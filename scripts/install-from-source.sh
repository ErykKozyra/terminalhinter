#!/usr/bin/env bash
# Builds terminalhinter from this checkout and installs it as ~/.local/bin/thint.
# The binary carries its own Node runtime, so changing the system Node version (nvm etc.) never breaks it.
# Safe to run again for updates. Also migrates an older install of this fork that used the `is` command.
set -euo pipefail
cd "$(dirname "$0")/.."

PLATFORM="$(node -p 'process.platform + "-" + process.arch')"
BIN_DIR="$HOME/.local/bin"
BEGIN_MARK="# >>> terminalhinter >>>"
END_MARK="# <<< terminalhinter <<<"

echo "==> Installing dependencies"
npm ci --no-audit --no-fund

echo "==> Compiling TypeScript"
npm run build

echo "==> Building the binary for $PLATFORM (the first run downloads the Node runtime it embeds)"
npm run package

BUILT="pkg/terminalhinter-$PLATFORM"
if [ ! -f "$BUILT" ]; then
  echo "The build did not produce $BUILT"
  exit 1
fi

echo "==> Installing to $BIN_DIR"
mkdir -p "$BIN_DIR"
# remove first so macOS does not reuse the old binary's cached code signature and kill the new one
rm -f "$BIN_DIR/thint"
cp "$BUILT" "$BIN_DIR/thint"
chmod +x "$BIN_DIR/thint"
ln -sf "$BIN_DIR/thint" "$BIN_DIR/terminalhinter"

# Older builds of this fork were installed as `is`; never touch an `is` outside ~/.local/bin.
if [ -e "$BIN_DIR/is" ] || [ -L "$BIN_DIR/inshellisense" ]; then
  rm -f "$BIN_DIR/is" "$BIN_DIR/inshellisense"
  echo "==> Removed the old 'is' binary from $BIN_DIR"
fi

if [ -f "$HOME/.inshellisenserc" ] && [ ! -f "$HOME/.terminalhinterrc" ]; then
  cp "$HOME/.inshellisenserc" "$HOME/.terminalhinterrc"
  echo "==> Copied your settings from ~/.inshellisenserc to ~/.terminalhinterrc"
fi

echo "==> Generating resources"
"$BIN_DIR/thint" reinit

ZSHRC="$HOME/.zshrc"
if [ -f "$ZSHRC" ] || [ "$(basename "${SHELL:-}")" = "zsh" ]; then
  touch "$ZSHRC"
  [ -f "$ZSHRC.before-terminalhinter" ] || cp "$ZSHRC" "$ZSHRC.before-terminalhinter"
  INIT_LINE="$("$BIN_DIR/thint" init zsh | tail -n 1)"
  # Drop any previous terminalhinter block and startup lines of the old `is` install, then put a fresh block
  # at the very top: anything above it would load twice, once outside and once inside terminalhinter.
  BEGIN_MARK="$BEGIN_MARK" END_MARK="$END_MARK" INIT_LINE="$INIT_LINE" perl -0pi -e '
    my ($b, $e, $init) = @ENV{qw(BEGIN_MARK END_MARK INIT_LINE)};
    s/^\Q$b\E\n.*?^\Q$e\E\n\n?//msg;
    s/^# inshellisense na samej gorze.*\n(?:export PATH="\$HOME\/\.local\/bin:\$PATH"\n)?//mg;
    s/^.*(?:inshellisense|terminalhinter)\/init\/zsh.*\n?//mg;
    s/\A\n+//;
    $_ = "$b\nexport PATH=\"\$HOME/.local/bin:\$PATH\"\n$init\n$e\n\n" . $_;
  ' "$ZSHRC"
  echo "==> Startup line is at the top of ~/.zshrc (backup: ~/.zshrc.before-terminalhinter)"
fi

if [ -d "$HOME/.local/share/inshellisense" ]; then
  rm -rf "$HOME/.local/share/inshellisense"
  echo "==> Removed the old resources folder ~/.local/share/inshellisense"
fi

if npm ls -g @microsoft/inshellisense >/dev/null 2>&1; then
  echo
  echo "The original inshellisense from npm is still installed. It is not needed:"
  echo "  npm uninstall -g @microsoft/inshellisense"
fi

echo
echo "Done. Open a new terminal tab."
