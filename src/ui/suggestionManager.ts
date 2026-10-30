// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Suggestion, SuggestionBlob } from "../runtime/model.js";
import type { ISTerm, ISTermPatch } from "../isterm/pty.js";
import { wcswidth } from "../utils/unicode.js";
import chalk from "chalk";
import { Shell } from "../utils/shell.js";
import log from "../utils/log.js";
import { getConfig } from "../utils/config.js";
import { activeTheme, Theme } from "./theme.js";
import { calculateReplacement, applyReplacement } from "../runtime/replacement.js";
import { getCommandCacheKey } from "../runtime/parser.js";
import { initializeRuntime } from "../runtime/initialize.js";

type SuggestionRuntime = Pick<Awaited<ReturnType<typeof initializeRuntime>>, "getSuggestions"> &
  Partial<Pick<Awaited<ReturnType<typeof initializeRuntime>>, "clearTransientSuggestionState" | "recordExecutedCommand">>;

const getMaxSuggestions = () => getConfig().maxSuggestions ?? 6;
const minBoxWidth = 36;
const maxBoxWidth = 64;
const iconWidth = 4; // pill or glyph, then a gap before the name
// Nerd Font code points: powerline round caps around a pill, and flat Font Awesome glyphs
const NF = {
  capLeft: "\ue0b6",
  capRight: "\ue0b4",
  folder: "\uf07b",
  file: "\uf15b",
  flag: "\uf024",
  star: "\uf005",
  tag: "\uf02b",
  alias: "\uf0c1",
};
// Files are tinted by kind with colors the theme already has, so a long `ls` list is easier to scan.
const fileKinds: [RegExp, keyof Theme["icons"]][] = [
  [/(^|[.-])lock$|\.lock$|-lock\.(json|ya?ml)$/i, "file"],
  [/\.(tsx?|jsx?|mjs|cjs|py|go|rs|java|kt|swift|rb|php|c|cc|cpp|h|hpp|cs|sh|bash|zsh|fish|vue|svelte|astro|lua|dart|sql)$/i, "alias"],
  [/\.(json|jsonc|ya?ml|toml|ini|env|xml|conf|cfg)$|^\.env|rc$|^Dockerfile|^Makefile/i, "star"],
  [/\.(css|scss|sass|less|styl|html?)$/i, "subcommand"],
  [/\.(png|jpe?g|gif|svg|webp|avif|ico|bmp|mp4|mov|webm|mp3|wav|ttf|otf|woff2?)$/i, "value"],
  [/\.(zip|tar|gz|tgz|bz2|xz|7z|rar|dmg|pkg|deb|rpm)$/i, "option"],
];
const fileColor = (name: string, theme: Theme): string => theme.icons[fileKinds.find(([pattern]) => pattern.test(name))?.[1] ?? "file"];

// border top + items + separator + footer + border bottom, plus one line for an unhandled newline at the end of the command
export const getMaxLines = () => getMaxSuggestions() + 5;
export const MIN_WIDTH = minBoxWidth;
export type KeyPressEvent = [string | null | undefined, KeyPress];

type KeyPress = {
  sequence: string;
  name: string;
  ctrl: boolean;
  shift: boolean;
};

export class SuggestionManager {
  #term: ISTerm;
  #commandKey: string;
  #activeSuggestionIdx: number;
  #suggestBlob?: SuggestionBlob;
  #shell: Shell;
  #hideSuggestions: boolean = false;
  #abortController?: AbortController;
  #runtime?: Promise<SuggestionRuntime>;
  #requestVersion = 0;
  #scrollTop = 0;
  #navigated = false; // the selection was moved with the arrows since this list appeared
  #inputVersion = 0; // keys passed to the shell so far
  #refreshRequested = false; // Ctrl+Space asked for the list
  #blobInputVersion = 0; // #inputVersion when the current list was requested

  constructor(terminal: ISTerm, shell: Shell, runtime?: Promise<SuggestionRuntime>) {
    this.#term = terminal;
    this.#commandKey = "";
    this.#activeSuggestionIdx = 0;
    this.#shell = shell;
    this.#runtime = runtime;
  }

  initialize(): void {
    this.#runtime ??= initializeRuntime(this.#shell);
    void this.#runtime.catch((e) => log.debug({ msg: "suggestion runtime initialization failed", e: (e as Error).message }));
  }

  private _getRuntime(): Promise<SuggestionRuntime> {
    this.initialize();
    return this.#runtime!;
  }

  invalidate(): void {
    this.#requestVersion += 1;
    this.#abortController?.abort();
  }

  async suspend(): Promise<void> {
    const commandCleared = this.#commandKey.length !== 0 || this.#abortController != null;
    this.invalidate();
    this.#commandKey = "";
    this.#suggestBlob = undefined;
    this.#activeSuggestionIdx = 0;
    this.#hideSuggestions = false;
    if (commandCleared) {
      try {
        const runtime = await this._getRuntime();
        runtime.clearTransientSuggestionState?.();
      } catch (e) {
        log.debug({ msg: "failed to clear transient suggestion state", e: (e as Error).message });
      }
    }
  }

  private async _loadSuggestions(): Promise<boolean> {
    const commandState = this.#term.getCommandState();
    const commandText = commandState.commandText;
    const commandKey = commandText ? `${this.#term.cwd}\u0000${getCommandCacheKey(commandText, this.#shell)}` : "";
    if (commandKey.length !== 0 && commandKey === this.#commandKey && !this.#hideSuggestions && !commandState.hasOutput) {
      // same text as the list on screen (e.g. the cursor moved), so the list is still right for it
      this.#blobInputVersion = this.#inputVersion;
      return false;
    }
    // Aborting is cooperative; the version check also rejects generators that ignore cancellation.
    const ownVersion = ++this.#requestVersion;
    this.#abortController?.abort();
    if (!commandText) {
      const commandCleared = this.#commandKey.length !== 0;
      this.#commandKey = "";
      if (commandCleared) {
        const runtime = await this._getRuntime();
        runtime.clearTransientSuggestionState?.();
      }
    }
    if (!commandText || this.#hideSuggestions || commandState.hasOutput) {
      const changed = this.#suggestBlob != null || this.#activeSuggestionIdx !== 0;
      this.#suggestBlob = undefined;
      this.#activeSuggestionIdx = 0;
      return changed;
    }
    const abortController = new AbortController();
    this.#abortController = abortController;
    const inputVersion = this.#inputVersion;
    try {
      const { getSuggestions } = await this._getRuntime();
      abortController.signal.throwIfAborted();
      const suggestionBlob = await getSuggestions(commandText, this.#term.cwd, this.#shell, abortController.signal);
      if (abortController.signal.aborted || ownVersion !== this.#requestVersion) {
        return false;
      }
      this.#commandKey = commandKey;
      this.#blobInputVersion = inputVersion;
      this.#suggestBlob = suggestionBlob;
      this._resetSelection();
      return true;
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        log.debug({ msg: "suggestion generation aborted", commandText, shell: this.#shell });
        return false;
      }
      throw e;
    } finally {
      if (this.#abortController === abortController) {
        this.#abortController = undefined;
      }
    }
  }

  // Nothing is preselected right after a space, so Enter runs the command. Once a word is being typed (or a folder was
  // just entered) the first entry is preselected and Enter accepts it, which is how Kiro/Fig behave.
  private _resetSelection() {
    this.#scrollTop = 0;
    this.#navigated = false;
    this.#activeSuggestionIdx = this._baseline();
  }

  private _baseline(): number {
    const token = this.#suggestBlob?.activeToken;
    // a lone "-" means "previous" (git checkout -, git switch -, cd -), so nothing is preselected and Enter runs it
    const typing = token != null && !token.complete && token.token.length > 0 && token.token !== "-";
    return typing || this.#suggestBlob?.isPathContext ? 0 : -1;
  }

  private _items(): Suggestion[] {
    if (!this.#suggestBlob) return [];
    const { suggestions, isPathContext, rootCommand, activeToken } = this.#suggestBlob;
    // a word typed in full whose only suggestion is itself, with nothing to add (e.g. `pwd` recalled from history)
    const only = suggestions.length === 1 ? suggestions[0] : undefined;
    if (!isPathContext && only != null && activeToken?.complete === false && only.name === activeToken.token && !only.description && !only.args) return [];
    if (!isPathContext || suggestions.length === 0) return suggestions;
    const entersDirectory = rootCommand != null && ["cd", "pushd", "z", "zi", "j"].includes(rootCommand);
    const executeItem: Suggestion = {
      name: "↪",
      allNames: ["↪"],
      icon: ">",
      priority: 100,
      execute: true,
      description: entersDirectory ? "Enter the current directory" : "Run the command with this path",
    };
    return [executeItem, ...suggestions];
  }

  private _partialText(): string {
    const token = this.#suggestBlob?.activeToken;
    if (token == null || token.complete) return "";
    const text = token.token;
    if (!token.isPath) return text;
    const lastSep = Math.max(text.lastIndexOf("/"), text.lastIndexOf("\\"));
    return lastSep === -1 ? text : text.substring(lastSep + 1);
  }

  // Every icon takes the same 4 cells so names line up. The default "plain" style is a colored mark with no
  // background (every terminal font has these and rows keep their gaps); "badge" puts the mark on a square built
  // from half blocks; "nerd" uses Nerd Font glyphs and rounded pills for terminals that have that font.
  private _icon(suggestion: Suggestion, selected: boolean): string {
    const style = getConfig().iconStyle;
    const theme = activeTheme();
    const ICON_COLORS = theme.icons;
    // on the selection bar a colored mark would fight the bar color, so plain marks take the selection text color
    const tint = (color: string) => (selected && style === "plain" ? theme.selectionText : color);
    const badge = (color: string, mark: string) => {
      const inner = chalk.bgHex(color).hex("#FFFFFF").bold(mark);
      if (style === "nerd") return chalk.hex(color)(NF.capLeft) + inner + chalk.hex(color)(NF.capRight) + " ";
      if (style === "badge") return chalk.hex(color)("▐") + inner + chalk.hex(color)("▌") + " ";
      return " " + chalk.hex(tint(color)).bold(mark) + "  ";
    };
    const icon = (color: string, nerdGlyph: string, mark: string) => (style === "nerd" ? " " + chalk.hex(color)(nerdGlyph) + "  " : badge(color, mark));

    if (suggestion.execute) return badge(ICON_COLORS.execute, ">");
    if (suggestion.type === "folder")
      return style === "plain" ? " " + chalk.hex(tint(ICON_COLORS.folder))("■") + "  " : icon(ICON_COLORS.folder, NF.folder, "/");
    if (suggestion.type === "file") return icon(fileColor(suggestion.name, theme), NF.file, "≡");

    switch (suggestion.icon.replace(/️/g, "")) {
      case "📦":
        return badge(ICON_COLORS.subcommand, "$");
      case "🔗":
        return icon(ICON_COLORS.option, NF.flag, "-");
      case "⭐":
        return icon(ICON_COLORS.star, NF.star, "*");
      case "🔥":
        // aliases from your shell config
        return icon(ICON_COLORS.alias, NF.alias, "=");
    }
    // a nerd font glyph the spec chose itself (only produced in the nerd style)
    if (style === "nerd" && wcswidth(suggestion.icon) <= 1) return " " + chalk.hex(ICON_COLORS.file)(suggestion.icon) + "  ";
    return icon(ICON_COLORS.value, NF.tag, "#");
  }

  private _displayName(suggestion: Suggestion): string {
    return suggestion.type === "folder" ? `${suggestion.name}/` : suggestion.name;
  }

  private _contentWidth(suggestion: Suggestion): number {
    const name = wcswidth(this._displayName(suggestion));
    const args = suggestion.args ? 1 + wcswidth(suggestion.args) : 0;
    return iconWidth + name + args;
  }

  private _renderRow(suggestion: Suggestion, innerWidth: number, selected: boolean, partial: string): string {
    const textWidth = innerWidth - 2 - iconWidth; // one space padding on each side, then the icon cell
    const name = this._displayName(suggestion);
    const [shownName, nameTruncated] = fitText(name, textWidth);
    const remaining = textWidth - wcswidth(shownName);
    let args = "";
    if (!nameTruncated && suggestion.args && remaining > 4) {
      args = fitText(suggestion.args, remaining - 1)[0];
    }
    const used = wcswidth(shownName) + (args ? 1 + wcswidth(args) : 0);

    const matchLength = partial.length > 0 && shownName.toLowerCase().startsWith(partial.toLowerCase()) ? partial.length : 0;
    const theme = activeTheme();
    const styledName =
      matchLength > 0
        ? chalk.bold.hex(theme.match)(shownName.slice(0, matchLength)) + chalk.bold(shownName.slice(matchLength))
        : selected
        ? chalk.bold(shownName)
        : shownName;
    const styledArgs = args ? " " + chalk.hex(selected ? theme.argsSelected : theme.args)(args) : "";

    const row = " " + this._icon(suggestion, selected) + styledName + styledArgs + " ".repeat(Math.max(textWidth - used, 0)) + " ";
    return selected ? chalk.bgHex(theme.selection).hex(theme.selectionText)(row) : row;
  }

  private _renderFooter(text: string, counter: string, innerWidth: number): string {
    const counterWidth = counter ? wcswidth(counter) + 1 : 0;
    const [shown] = fitText(text, innerWidth - 2 - counterWidth);
    const gap = innerWidth - 2 - wcswidth(shown) - counterWidth;
    const theme = activeTheme();
    return " " + chalk.italic.hex(theme.footer)(shown) + " ".repeat(Math.max(gap, 0)) + (counter ? " " + chalk.hex(theme.counter)(counter) : "") + " ";
  }
  // true once after Ctrl+Space asked to open the list, so the UI loads it without waiting for new output
  consumeRefreshRequest(): boolean {
    const requested = this.#refreshRequested;
    this.#refreshRequested = false;
    return requested;
  }

  async exec(): Promise<boolean> {
    return await this._loadSuggestions();
  }

  // maxLines: the rows free above or below the prompt; in a short terminal the list shows fewer rows and scrolls
  render(direction: "above" | "below", cursorX: number, maxLines = getMaxLines()): ISTermPatch[] {
    if (!this.#suggestBlob) {
      return [];
    }
    const { argumentDescription, activeToken } = this.#suggestBlob;
    const items = this._items();
    const maxSuggestions = Math.max(Math.min(getMaxSuggestions(), maxLines - (getMaxLines() - getMaxSuggestions())), 1);
    if (this.#activeSuggestionIdx >= items.length) this.#activeSuggestionIdx = items.length - 1;

    const cols = this.#term.cols;
    const borderColor = activeTheme().border;
    const border = (text: string) => chalk.hex(borderColor)(text);
    const rounded = getConfig().boxBorderStyle === "rounded";
    const [tl, tr, bl, br] = rounded ? ["╭", "╮", "╰", "╯"] : ["┌", "┐", "└", "┘"];

    // keep the selected entry inside the visible window instead of jumping by pages
    if (this.#activeSuggestionIdx >= 0) {
      if (this.#activeSuggestionIdx < this.#scrollTop) this.#scrollTop = this.#activeSuggestionIdx;
      if (this.#activeSuggestionIdx >= this.#scrollTop + maxSuggestions) this.#scrollTop = this.#activeSuggestionIdx - maxSuggestions + 1;
    }
    this.#scrollTop = Math.max(0, Math.min(this.#scrollTop, Math.max(items.length - maxSuggestions, 0)));
    const visible = items.slice(this.#scrollTop, this.#scrollTop + maxSuggestions);

    const active = this.#activeSuggestionIdx >= 0 ? items.at(this.#activeSuggestionIdx) : undefined;
    const footerText = active?.description || argumentDescription || "";
    const counter =
      items.length <= maxSuggestions ? "" : this.#activeSuggestionIdx >= 0 ? `${this.#activeSuggestionIdx + 1}/${items.length}` : `${items.length}`;

    const widest = Math.max(0, ...items.map((item) => this._contentWidth(item)));
    const maxWidth = Math.min(maxBoxWidth, cols);
    if (maxWidth < 12) return [];
    const width = Math.max(Math.min(Math.max(widest + 4, minBoxWidth), maxWidth), Math.min(minBoxWidth, maxWidth));
    const innerWidth = width - 2;

    const rows: string[] = [];
    rows.push(border(tl + "─".repeat(innerWidth) + tr));
    if (visible.length === 0) {
      if (!argumentDescription) return [];
      rows.push(border("│") + this._renderFooter(argumentDescription, "", innerWidth) + border("│"));
    } else {
      const partial = this._partialText();
      visible.forEach((item, idx) => {
        const selected = idx + this.#scrollTop === this.#activeSuggestionIdx;
        rows.push(border("│") + this._renderRow(item, innerWidth, selected, partial) + border("│"));
      });
      if (footerText || counter) {
        rows.push(border("├" + "─".repeat(innerWidth) + "┤"));
        rows.push(border("│") + this._renderFooter(footerText, counter, innerWidth) + border("│"));
      }
    }
    rows.push(border(bl + "─".repeat(innerWidth) + br));

    // line the icons up under the word being completed, the way Kiro anchors its popup
    const wrappedCursor = cursorX % cols;
    const partialWidth = activeToken != null && !activeToken.complete ? wcswidth(this._partialText()) : 0;
    const anchor = Math.max(wrappedCursor - partialWidth - 2, 0);
    const startX = Math.max(Math.min(anchor, cols - width), 0);

    return rows.map((data) => ({ startX, length: width, data }));
  }
  update(keyPress: KeyPress, allowBindings = true): boolean {
    const handled = this._update(keyPress, allowBindings);
    // a key that went to the shell changes the line, so the list on screen no longer belongs to it
    if (!handled && keyPress.name != "return") this.#inputVersion += 1;
    return handled;
  }

  private _update(keyPress: KeyPress, allowBindings: boolean): boolean {
    const { name, shift, ctrl } = keyPress;

    // Ctrl+Space (sent as ^@, which readline names "`") opens the list on demand, or closes it when it is open
    if (ctrl && (name == "`" || name == "space")) {
      if (this.#suggestBlob != null && allowBindings) {
        this.#suggestBlob = undefined;
        this.#hideSuggestions = true;
      } else {
        this.#hideSuggestions = false;
        this.#commandKey = "";
        this.#refreshRequested = true;
      }
      return true;
    }

    // if suggestions are hidden, keep them hidden until during command navigation
    if (this.#hideSuggestions) {
      this.#hideSuggestions = name == "up" || name == "down";
    }

    // the list can lag behind fast typing: if it was made for different text than what is on the line now, Enter
    // and Tab must not insert one of its entries (`git checkout fix/header` + quick Enter once inserted a branch
    // picked from the older list)
    if (this.#suggestBlob != null && (name == "return" || name == "tab") && this._isStale()) {
      if (name == "return") {
        this.#suggestBlob = undefined;
        this._recordExecution();
        this.#term.clearCommand();
      }
      return false;
    }

    if (!allowBindings || !this.#suggestBlob) {
      if (name == "return") {
        // the command is being executed
        this._recordExecution();
        this.#term.clearCommand();
      }
      return false;
    }
    const {
      dismissSuggestions: { key: dismissKey, shift: dismissShift, control: dismissCtrl },
      acceptSuggestion: { key: acceptKey, shift: acceptShift, control: acceptCtrl },
      nextSuggestion: { key: nextKey, shift: nextShift, control: nextCtrl },
      previousSuggestion: { key: prevKey, shift: prevShift, control: prevCtrl },
    } = getConfig().bindings;
    const items = this._items();

    if (name == dismissKey && shift == !!dismissShift && ctrl == !!dismissCtrl) {
      this.#suggestBlob = undefined;
      this.#hideSuggestions = true;
    } else if (name == prevKey && shift == !!prevShift && ctrl == !!prevCtrl) {
      // nothing selected, or the list was never moved: let the shell walk its history, so Up keeps going back
      // through older commands even when a recalled command opened the list. Once you moved in the list, Up at the
      // top stays there instead of replacing the line.
      if (this.#activeSuggestionIdx < 0 || items.length === 0) return false;
      if (!this.#navigated && this.#activeSuggestionIdx <= this._baseline()) return false;
      this.#activeSuggestionIdx = Math.max(this.#activeSuggestionIdx - 1, this._baseline());
    } else if (name == nextKey && shift == !!nextShift && ctrl == !!nextCtrl) {
      if (items.length === 0) return false;
      this.#navigated = true;
      this.#activeSuggestionIdx = Math.min(this.#activeSuggestionIdx + 1, items.length - 1);
    } else if (name == "return" && !shift && !ctrl) {
      return this._handleEnter(items);
    } else if ((name == acceptKey && shift == !!acceptShift && ctrl == !!acceptCtrl) || (name == "tab" && !shift && !ctrl)) {
      const idx = Math.max(this.#activeSuggestionIdx, 0);
      const suggestion = items.at(idx)?.execute ? items.at(idx + 1) : items.at(idx);
      if (!this._accept(suggestion)) return false;
    } else if (name == "c" && ctrl) {
      this.#term.clearCommand();
      return false;
    } else {
      return false;
    }
    log.debug({ msg: "handled keypress", ...keyPress });
    return true;
  }

  private _isStale(): boolean {
    const { commandText } = this.#term.getCommandState();
    const currentKey = commandText ? `${this.#term.cwd}\u0000${getCommandCacheKey(commandText, this.#shell)}` : "";
    return currentKey !== this.#commandKey || this.#inputVersion !== this.#blobInputVersion;
  }

  private _handleEnter(items: Suggestion[]): boolean {
    const suggestion = this.#activeSuggestionIdx >= 0 ? items.at(this.#activeSuggestionIdx) : undefined;
    if (getConfig().enterAcceptsSuggestion && suggestion != null && !suggestion.execute && this._accept(suggestion)) {
      log.debug({ msg: "accepted suggestion with enter", name: suggestion.name });
      return true;
    }
    // nothing to accept (or the ↪ entry): run the command
    this.#suggestBlob = undefined;
    this.#activeSuggestionIdx = 0;
    this._recordExecution();
    this.#term.clearCommand();
    return false;
  }

  // feeds the frecency ranking; only what was typed at the prompt, never program output
  private _recordExecution() {
    const { commandText, hasOutput } = this.#term.getCommandState();
    if (!commandText || hasOutput) return;
    const cwd = this.#term.cwd;
    void this._getRuntime()
      .then((runtime) => runtime.recordExecutedCommand?.(commandText, cwd, this.#shell))
      .catch((e) => log.debug({ msg: "could not record command", e: (e as Error).message }));
  }

  private _accept(suggestion: Suggestion | undefined): boolean {
    if (suggestion == null || suggestion.execute) return false;
    const action = calculateReplacement(this.#suggestBlob?.activeToken, suggestion);
    if (action == null) return false;
    const token = this.#suggestBlob?.activeToken;
    if (token != null && action.backspaceCount === token.tokenLength && action.insertText.trimEnd() === token.token) return false; // already typed in full, so Enter runs it
    this.#term.write(applyReplacement(action));
    return true;
  }
}

// Cuts text to a display width (wide characters count as two cells) and adds an ellipsis when something was cut.
const fitText = (text: string, width: number): [string, boolean] => {
  if (width <= 0) return ["", text.length > 0];
  if (wcswidth(text) <= width) return [text, false];
  let out = "";
  let used = 0;
  for (const point of text) {
    const w = wcswidth(point);
    if (used + w > width - 1) break;
    out += point;
    used += w;
  }
  return [out + "…", true];
};
