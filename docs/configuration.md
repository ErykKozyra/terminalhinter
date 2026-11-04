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
showHints = true                # short tips in the list, e.g. that Shift+Up/Down reorders it
boxBackground = true            # the list sits on its own background, like a card
boxBorderStyle = "rounded"      # or "square"

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

## Where your data is

- `~/.local/share/terminalhinter/history.jsonl` is what you picked, which is used to rank the list. It never
  leaves your machine.
- `~/.local/share/terminalhinter/order.json` is the order you set with Shift+Up / Shift+Down
  (`thint order list`, `thint order reset`).
- `~/.config/terminalhinter/specs/` holds your own suggestions (`thint specs new`).

## Why there is no ghost text

There is no inline "ghost text" on purpose. zsh-autosuggestions already does that well, and the two would draw
over each other.
