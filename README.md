# terminalhinter

IDE-style autocomplete for your terminal, with the navigation people liked in Fig and Kiro CLI:
a dropdown under the cursor for folders, git branches, npm scripts and subcommands of 600+ CLIs,
each with a short description.

```
➜  my-app git:(main) ✗ cd websites/
                       ╭──────────────────────────────────╮
                       │  >  ↪                            │
                       │  ■  admin-panel/                 │
                       │  ■  landing/                     │
                       │  ■  shop/                        │
                       ├──────────────────────────────────┤
                       │ Enter the current directory      │
                       ╰──────────────────────────────────╯
```

The command is `thint` (long form: `terminalhinter`).

> **Status:** early, used daily on macOS with zsh and oh-my-zsh. Linux (bash, zsh) is tested.
> Windows and fish work in the upstream project but are not yet tested with the changes in this fork.

## What it does

- **Walk into folders with Enter.** Enter on a folder inserts it and keeps the list open with its
  contents. The `↪` entry at the top runs the command, so `cd` + Enter, Enter, Enter lands you deep in a tree.
- **Descriptions and argument hints** for subcommands and options, e.g. `checkout [branch, file, tag or commit]`.
- **Your aliases**, with what each one expands to.
- **Sensible ranking.** An exact match comes first (`pnpm dev` offers the `dev` script before `dev:vite`).
- **Stays out of the way.** Right after a space nothing is selected, so Enter just runs the command.
  `git checkout -` and `cd -` run immediately.
- **No special fonts.** Icons are plain characters every terminal font has.
- **Independent of your Node version.** The binary carries its own runtime, so switching Node with nvm never breaks it.
- **Your terminal tab still says `zsh`.**

## Install

Published packages are coming. Until then, build from source (needs Node 18 to 22 and git; Node is only needed for the build):

```bash
git clone https://github.com/ErykKozyra/terminalhinter.git
cd terminalhinter
./scripts/install-from-source.sh
```

The script builds a single binary, installs it as `~/.local/bin/thint`, adds `~/.local/bin` to your `PATH`
and puts the startup line at the top of `~/.zshrc`. Open a new terminal tab afterwards.

To remove it: `./scripts/uninstall-local.sh`. It also takes the startup block out of `~/.zshrc`.

### Fast startup

The startup line belongs at the **top** of `~/.zshrc`. terminalhinter starts a fresh shell inside itself,
so anything above the line loads twice. The install script puts it there for you.

If you use nvm, loading it lazily saves another half a second per tab.

## Usage

| Key | Action |
| --- | --- |
| Enter | Accept the selected suggestion; on a folder, walk into it; on `↪`, run the command |
| Tab | Accept the selected (or first) suggestion |
| Up / Down | Move the selection; Up with nothing selected goes to shell history |
| Escape | Close the list |

Commands:

```bash
thint doctor   # check the installation
thint reinit   # regenerate resources after an update
thint -c       # is this shell running inside terminalhinter?
```

## Configuration

Settings live in `~/.terminalhinterrc` or `~/.config/terminalhinter/rc.toml` (TOML). Top-level keys go
before any `[section]`. A broken file never closes your terminal: you get a warning and the defaults.

```toml
useAliases = true                       # suggest your shell aliases (default: true)
maxSuggestions = 10                     # rows visible at once (default: 6)
enterAcceptsSuggestion = true           # false: Enter always runs, accept with Tab only
iconStyle = "plain"                     # "plain", "badge" or "nerd" (needs a Nerd Font)
activeSuggestionBackgroundColor = "#2F5FD0"
borderColor = "#4B5263"
boxBorderStyle = "rounded"              # or "square"

[bindings.acceptSuggestion]
key = "tab"

[bindings.nextSuggestion]
key = "down"

[bindings.previousSuggestion]
key = "up"

[bindings.dismissSuggestions]
key = "escape"
```

## Supported shells

bash, zsh, fish, PowerShell (pwsh and Windows PowerShell), xonsh and nushell, plus cmd (experimental).
The fork's changes are tested on zsh and bash so far.

## Credits

terminalhinter is a fork of [microsoft/inshellisense](https://github.com/microsoft/inshellisense) by
Microsoft, released under the MIT License. The command specs come from
[withfig/autocomplete](https://github.com/withfig/autocomplete) (MIT). Thanks to both projects; most of
the hard work lives there.

This project is not affiliated with or endorsed by Microsoft, Amazon (Kiro) or Fig.

## License

[MIT](LICENSE)
