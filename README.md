# terminalhinter

**A dropdown for your terminal.** Folders, git branches, npm scripts and 600+ CLIs show up under the cursor as
you type, each with a short description. Like Fig or Kiro CLI, but open source, and what it learns about you stays on your machine.

![The list after typing pnpm d](docs/preview.png)

**[Try the live demo](https://erykkozyra.github.io/terminalhinter/)** in your browser, no install needed.

## Install

```bash
npm i -g @erykkozyra/terminalhinter
thint init
```

`thint init` asks for your shell, a theme and icons, with a live preview. Then open a new terminal tab and type
`git ` or `cd `.

Works on macOS and Linux with zsh and bash. Windows and fish are experimental.

## What it does

- **Enter walks into folders.** The list stays open with what is inside, so `cd` and a few Enters take you deep
  into a project. The `↪` entry at the top runs the command where you are.
- **It learns what you use.** Entries you pick often move up, recent ones more than old ones.
- **You can set the order yourself.** Shift+Up / Shift+Down moves the selected entry, and the list keeps that
  order next time.
- **It knows your project.** Workspace packages for `pnpm --filter` and `yarn workspace`, tasks from `turbo.json`,
  and the age and message of the last commit next to every git branch.
- **Letters in order are enough.** `chkt` finds `checkout`.
- **Your aliases and zsh functions** show up too: an alias with what it expands to, a function with the file it comes from.
- **It stays out of the way.** Right after a space nothing is selected, so Enter just runs the command.

## Keys

| Key | What it does |
| --- | --- |
| Enter | Accept, walk into a folder, or run the command on `↪` |
| Tab | Accept the selected entry |
| ↑ ↓ | Move the selection; ↑ with nothing selected goes to your shell history |
| Shift+↑ ↓ | Move the selected entry in the list |
| Esc | Hide the list until you type again |
| Ctrl+Space | Show it again |

On a Mac, Ctrl is the Control key (⌃), not Command.

## Commands

| Command | What it does |
| --- | --- |
| `thint init` | Guided setup |
| `thint theme` | Pick a theme: thint, light, nord or dracula |
| `thint config` | Show or change settings ([all of them](docs/configuration.md)) |
| `thint bookmark add` | Bookmark a folder, so `cd` offers it from anywhere |
| `thint specs new` | Start your own suggestions for a command |
| `thint order reset` | Forget an order you set with Shift+↑ ↓ |
| `thint doctor` | Check the installation and tell you how to fix it |

## Your own suggestions

For in-house scripts and tools, put a YAML file in `~/.config/terminalhinter/specs`:

```yaml
name: deploy
subcommands:
  - name: staging
    args: { name: app, suggestions: [web, admin] }
  - name: logs
    args: { name: service, script: "ls services" } # every line of the output is a suggestion
options:
  - name: [--force, -f]
    description: Skip the checks
```

`thint specs check` points out mistakes. A broken file is skipped and the rest keep working.

## Looks best in VS Code with

```json
"terminal.integrated.lineHeight": 1.3,
"terminal.integrated.minimumContrastRatio": 1,
"terminal.integrated.gpuAcceleration": "on"
```

`minimumContrastRatio: 1` stops VS Code from changing the colors of the list. Any monospace font works.

<details>
<summary><b>Updating, nvm, installing from source, uninstalling</b></summary>

**Updating.** `npm i -g @erykkozyra/terminalhinter`, then `thint reinit` once.

**nvm.** thint carries its own runtime, so switching Node never breaks the list in open tabs. The `thint`
command itself belongs to the Node version you installed it with, like any global npm package. After you
switch the default version, run `npm i -g` again, or install from source.

**From source** (needs Node 18+ and git, only for the build):

```bash
git clone https://github.com/ErykKozyra/terminalhinter.git
cd terminalhinter
./scripts/install-from-source.sh
```

This puts a single binary in `~/.local/bin/thint` that does not depend on Node at all.

**Startup lines.** `thint init` puts them at the very top of your shell config and keeps a backup. thint starts
a fresh shell inside itself, so anything above those lines would load twice.

**Uninstalling.**

```bash
thint uninstall
npm rm -g @erykkozyra/terminalhinter
```

`thint uninstall` takes the startup lines out of your shell config and removes thint's files.

</details>

## Credits

A fork of [microsoft/inshellisense](https://github.com/microsoft/inshellisense), with command specs from
[withfig/autocomplete](https://github.com/withfig/autocomplete). Most of the hard work lives there. Not
affiliated with Microsoft, Amazon or Fig.

[MIT License](LICENSE)
