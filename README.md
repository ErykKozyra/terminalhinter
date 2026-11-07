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

**When something goes wrong**

- **It offers the fix for the command that just failed.** A typo (`gti` → `git`), a missing upstream branch, a
  branch or script with a near name, a folder that needs `-p`, a port that is taken. Tab puts it on the line;
  nothing runs by itself.
- **Ctrl+G explains a line before you run it**: every word with what it means, through pipes, `&&`, redirects and
  `sudo`, with a warning for the parts that delete or overwrite things.
- **Risky entries are marked red** and say why: `--force`, `reset --hard`, `rm -r`, a Make target tagged `[prod]`,
  an ssh host called `PROD`.

**It knows your project**

- **Your tasks:** Makefile targets with their `##` descriptions and sections, just recipes, Taskfile tasks, docker
  compose services, mise and deno tasks, package.json scripts, turbo tasks, workspace packages for `--filter`.
- **git with context:** the age and message of the last commit next to every branch, stashes by what they hold,
  the reflog after `git reset`, and your aliases complete like the command behind them.
- **Ports:** `kill` starts with the processes listening on a port, with their folder (`:3000 next dev · ~/Dev/shop`).
- **Package versions:** `npm i react@` lists the tags and the newest releases (pnpm, yarn and bun too).
- **What you ran here:** typing the first word brings back whole commands you ran in this folder. Lines that look
  like they hold a password or token are never stored.

**And it gets out of the way**

- **Enter walks into folders.** The list stays open with what is inside; the `↪` entry runs the command where you
  are. `cd` also finds folders from anywhere through your bookmarks and zoxide.
- **It learns what you use**, and Shift+Up / Shift+Down puts the list in your own order.
- **Letters in order are enough.** `chkt` finds `checkout`.
- **Right after a space nothing is selected**, so Enter just runs the command.

## Keys

| Key | What it does |
| --- | --- |
| Enter | Accept, walk into a folder, or run the command on `↪` |
| Tab | Accept the selected entry |
| ↑ ↓ | Move the selection; ↑ with nothing selected goes to your shell history |
| Shift+↑ ↓ | Move the selected entry in the list |
| Esc | Hide the list until you type again |
| Ctrl+Space | Show it again |
| Ctrl+G | What each word of the line does |
| Tab on an empty line | Take the fix offered after a failed command |

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
| `thint snippets new` | Start your snippets: commands with fields to fill in |
| `thint migrate` | Move over from Kiro CLI, Amazon Q or Fig |
| `thint update` | Install the newest version |
| `thint doctor` | Check the installation and tell you how to fix it |

## Coming from Kiro CLI or Fig

Kiro CLI 3.0 dropped its autocomplete, and Fig is gone. terminalhinter gives you the same dropdown, locally and
without an account. `thint migrate` takes the Kiro CLI, Amazon Q or Fig lines out of your shell files (keeping a
copy of each file), and your own Fig specs in `~/.fig/autocomplete/build` can be loaded as they are.

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

**Updating.** `thint update`. A new tab tells you once when a new version is out; `thint config set updateCheck false` turns that off. An update with `npm i -g` works too: the next new tab picks it up by itself.

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
