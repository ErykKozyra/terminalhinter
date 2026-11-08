# Configuration

Settings live in `~/.terminalhinterrc` or `~/.config/terminalhinter/rc.toml` (TOML). The easiest way to change
them is `thint config`:

```bash
thint config list                   # every setting and its value
thint config set maxSuggestions 8
thint config unset maxSuggestions   # back to the default
```

A broken file never closes your terminal: you get a warning and the defaults.

## Every setting

When you edit the file by hand, keep the top-level keys above any `[section]`.

```toml
theme = "thint"                 # "thint", "light", "nord" or "dracula"
maxSuggestions = 10             # rows visible at once (default: 6)
iconStyle = "plain"             # "plain" (colored squares), "marks", "badge" or "nerd" (needs a Nerd Font)
argumentHints = "selected"      # hints like [branch]: "selected" (only the selected row), "all" or "none"
fuzzyMatching = true            # letters in order are enough: chkt finds checkout
useAliases = true               # suggest your shell aliases
enterAcceptsSuggestion = true   # false: Enter always runs the command, accept with Tab only
enterRuns = false               # true: Enter takes the entry and runs the line at once (a folder is still walked into)
showHints = true                # short tips in the list, e.g. that Shift+Up/Down reorders it
boxBackground = true            # the list sits on its own background, like a card
boxBorderStyle = "rounded"      # or "square"
updateCheck = true              # once a day, ask npm whether a new version is out; false also hides the star note
tabBehavior = "accept"          # "accept": Tab takes the selected entry; "shell": Tab adds what all entries share, then walks the list
showListOn = "typing"           # "typing": the list follows you; "tab": it only opens on Tab or Ctrl+Space
fixSuggestions = true           # after a command fails, an empty line offers a fix (Tab puts it on the line)
historyEntries = true           # whole commands you ran in this folder (or elsewhere in its repository) show up as you type their first word

# optional, override the theme
activeSuggestionBackgroundColor = "#2F5FD0"
borderColor = "#4B5263"
```

## Keys

```toml
[bindings.acceptSuggestion]
key = "tab"

[bindings.nextSuggestion]
key = "down"

[bindings.previousSuggestion]
key = "up"

[bindings.dismissSuggestions]
key = "escape"
```

## Snippets

Commands with fields to fill in live in `~/.config/terminalhinter/snippets.yaml` (`thint snippets new` starts it
with examples):

```yaml
- name: release
  description: Tag a version and push the tag
  command: git tag v{{version}} && git push origin v{{version}}
- name: freeport
  command: kill $(lsof -ti :{{port:3000}})
```

Type the start of a name and accept it: the list asks for each field (`{{port:3000}}` has 3000 as its default), Tab
goes to the next one, and the finished command lands on the line. Nothing runs until you press Enter.

## Keys you might not know

- **Ctrl+G** shows what every word of the line does, from the command specs, with a warning for things like
  `rm -rf /` or a force push to main. Ctrl+G again or Esc closes it.
- **Tab on an empty line after a failed command** puts the offered fix on the line.

## Where your data is

- `~/.local/share/terminalhinter/history.jsonl` is what you picked, which is used to rank the list. It never
  leaves your machine.
- `~/.local/share/terminalhinter/order.json` is the order you set with Shift+Up / Shift+Down
  (`thint order list`, `thint order reset`).
- `~/.config/terminalhinter/specs/` holds your own suggestions (`thint specs new`).
- `~/.local/share/terminalhinter/commands.jsonl` is the whole commands you ran, with the folder, for the history
  entries in the list. Lines that look like they hold a token or password are never written. With Atuin installed,
  its history is read too (read-only).
- `~/.local/share/terminalhinter/update.json` is when thint last asked npm for the newest version, and what it
  said. It is the same plain request for the version number that `npm view` makes, with nothing about you in it.
  It also keeps the date of your first tab, so a one-time note asking for a star on GitHub shows three days later
  (not with `updateCheck = false`).

## Why there is no ghost text

There is no inline "ghost text" on purpose. zsh-autosuggestions already does that well, and the two would draw
over each other.
