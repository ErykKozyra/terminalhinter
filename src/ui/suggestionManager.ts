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
import { hasCustomOrder } from "../runtime/order.js";

type SuggestionRuntime = Pick<Awaited<ReturnType<typeof initializeRuntime>>, "getSuggestions"> &
  Partial<Pick<Awaited<ReturnType<typeof initializeRuntime>>, "clearTransientSuggestionState" | "recordExecutedCommand" | "reorderSuggestions">>;

const getMaxSuggestions = () => getConfig().maxSuggestions ?? 6;
const minBoxWidth = 36;
const reorderHint = "shift+↑↓ reorder";
const maxBoxWidth = 76;
const maxNameColumn = 36;
const maxArgsWidth = 18;
const maxDescriptionColumn = 40;
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
  meta?: boolean;
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
  #reordered = false; // you moved an entry in this session, so the reorder hint is no longer needed
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
    // on the selection bar a colored mark would fight the bar color, so it takes the selection text color there
    const tint = (color: string) => (selected && (style === "plain" || style === "marks") ? theme.selectionText : color);
    const badge = (color: string, mark: string) => {
      const inner = chalk.bgHex(color).hex("#FFFFFF").bold(mark);
      if (style === "nerd") return chalk.hex(color)(NF.capLeft) + inner + chalk.hex(color)(NF.capRight) + " ";
      if (style === "badge") return chalk.hex(color)("▐") + inner + chalk.hex(color)("▌") + " ";
      // plain: one small square per entry, its color tells the kind
      if (style === "plain") return " " + chalk.hex(tint(color))("■") + "  ";
      return " " + chalk.hex(tint(color)).bold(mark) + "  ";
    };
    const icon = (color: string, nerdGlyph: string, mark: string) => (style === "nerd" ? " " + chalk.hex(color)(nerdGlyph) + "  " : badge(color, mark));

    if (suggestion.execute) return style === "plain" ? " " + chalk.hex(tint(ICON_COLORS.execute))("■") + "  " : badge(ICON_COLORS.execute, ">");
    if (suggestion.type === "folder")
      return style === "plain" || style === "marks" ? " " + chalk.hex(tint(ICON_COLORS.folder))("■") + "  " : icon(ICON_COLORS.folder, NF.folder, "/");
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

  // name and argument hints, the first column of a row
  private _nameWidth(suggestion: Suggestion): number {
    const name = wcswidth(this._displayName(suggestion));
    // long argument hints are cut so they do not push the descriptions out of the box
    return name + (suggestion.args ? 1 + Math.min(wcswidth(suggestion.args), maxArgsWidth) : 0);
  }

  // the ↪ entry says what it does in its own row
  private _inlineDescription(suggestion: Suggestion): string {
    return suggestion.execute ? "" : (suggestion.description ?? "").replace(/\s+/g, " ").trim();
  }

  // A row is a bar inside the box with one cell of air on each side, so the selection reads as a highlight floating
  // in the list rather than a stripe from edge to edge: icon, name (+ argument hints), then the description in its
  // own column.
  private _renderRow(suggestion: Suggestion, innerWidth: number, selected: boolean, partial: string, nameColumn: number): string {
    const theme = activeTheme();
    const barWidth = innerWidth - 2;
    const textWidth = barWidth - iconWidth - 1; // the icon cell, then one space at the right end of the bar
    const column = Math.min(nameColumn, textWidth);
    const [shownName, nameTruncated] = fitText(this._displayName(suggestion), column);
    let args = "";
    if (!nameTruncated && suggestion.args && column - wcswidth(shownName) > 4) args = fitText(suggestion.args, column - wcswidth(shownName) - 1)[0];
    const firstWidth = wcswidth(shownName) + (args ? 1 + wcswidth(args) : 0);

    const description = this._inlineDescription(suggestion);
    const descWidth = textWidth - column - 2;
    const shownDescription = description && descWidth >= 6 ? fitText(description, descWidth)[0] : "";

    const matchLength = partial.length > 0 && shownName.toLowerCase().startsWith(partial.toLowerCase()) ? partial.length : 0;
    const nameColor = selected ? theme.selectionText : theme.text;
    const styledName =
      matchLength > 0
        ? chalk.bold.hex(theme.match)(shownName.slice(0, matchLength)) + chalk.bold.hex(nameColor)(shownName.slice(matchLength))
        : selected
        ? chalk.bold.hex(nameColor)(shownName)
        : chalk.hex(nameColor)(shownName);
    const dim = (text: string) => chalk.hex(selected ? theme.argsSelected : theme.args)(text);
    let content = styledName + (args ? " " + dim(args) : "");
    let contentWidth = firstWidth;
    if (shownDescription) {
      content += " ".repeat(column - firstWidth) + "  " + dim(shownDescription);
      contentWidth = column + 2 + wcswidth(shownDescription);
    }
    const bar = this._icon(suggestion, selected) + content + " ".repeat(Math.max(textWidth - contentWidth, 0)) + " ";
    return " " + (selected ? chalk.bgHex(theme.selection)(bar) : bar) + " ";
  }

  // true when the row shows the whole description, so the footer does not have to repeat it
  private _descriptionFits(suggestion: Suggestion, innerWidth: number, nameColumn: number): boolean {
    const textWidth = innerWidth - 2 - iconWidth - 1;
    const descWidth = textWidth - Math.min(nameColumn, textWidth) - 2;
    const description = this._inlineDescription(suggestion);
    return description.length > 0 && descWidth >= 6 && wcswidth(description) <= descWidth;
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
    // the inside of the box gets the panel color, the border keeps the terminal background so corners stay round
    const panelColor = activeTheme().panel;
    const panel = (text: string) => (getConfig().boxBackground ? chalk.bgHex(panelColor)(text) : text);
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

    // first column as wide as the widest name, the descriptions next to it get what is left (up to maxBoxWidth)
    const nameColumn = Math.min(Math.max(0, ...visible.map((item) => this._nameWidth(item))), maxNameColumn);
    const descColumn = Math.min(Math.max(0, ...visible.map((item) => wcswidth(this._inlineDescription(item)))), maxDescriptionColumn);
    const widest = iconWidth + nameColumn + (descColumn > 0 ? 2 + descColumn : 0) + 1 + 2;
    const maxWidth = Math.min(maxBoxWidth, cols);
    if (maxWidth < 12) return [];
    // the reorder hint may widen the box a little so it fits next to the start of the description
    const hintWidth = this._wantsReorderHint(active)
      ? wcswidth(counter ? `${reorderHint} · ${counter}` : reorderHint) + Math.min(wcswidth(footerText), 16) + 5
      : 0;
    const width = Math.max(Math.min(Math.max(widest + 2, minBoxWidth, hintWidth), maxWidth), Math.min(minBoxWidth, maxWidth));
    const innerWidth = width - 2;

    const rows: string[] = [];
    // top and bottom lines stay on the terminal background (a line sits in the middle of its cell, so a colored
    // cell would stick out above or below the card); the separator inside the card is on the panel
    const edge = (left: string, right: string, onPanel = false) =>
      border(left) + (onPanel ? panel(border("─".repeat(innerWidth))) : border("─".repeat(innerWidth))) + border(right);
    rows.push(edge(tl, tr));
    if (visible.length === 0) {
      if (!argumentDescription) return [];
      rows.push(border("│") + panel(this._renderFooter(argumentDescription, "", innerWidth)) + border("│"));
    } else {
      const partial = this._partialText();
      visible.forEach((item, idx) => {
        const selected = idx + this.#scrollTop === this.#activeSuggestionIdx;
        rows.push(border("│") + panel(this._renderRow(item, innerWidth, selected, partial, nameColumn)) + border("│"));
      });
      // while you walk the list, a short hint tells that the order can be changed; it stops once you have done it
      const shownFooter = active != null && this._descriptionFits(active, innerWidth, nameColumn) ? argumentDescription ?? "" : footerText;
      const hint = this._reorderHint(active, shownFooter, counter, innerWidth);
      if (shownFooter || hint) {
        rows.push(edge("├", "┤", true));
        rows.push(border("│") + panel(this._renderFooter(shownFooter, hint ? (counter ? `${hint} · ${counter}` : hint) : counter, innerWidth)) + border("│"));
      } else if (counter && innerWidth >= wcswidth(counter) + 4) {
        // nothing else for a footer: the position goes into the top edge instead of a row of its own
        const fill = innerWidth - wcswidth(counter) - 3;
        rows[0] = border(tl + "─".repeat(fill) + " ") + chalk.hex(activeTheme().counter)(counter) + border(" ─" + tr);
      }
    }
    rows.push(edge(bl, br));

    // line the icons up under the word being completed, the way Kiro anchors its popup
    const wrappedCursor = cursorX % cols;
    const partialWidth = activeToken != null && !activeToken.complete ? wcswidth(this._partialText()) : 0;
    const anchor = Math.max(wrappedCursor - partialWidth - 3, 0); // border, air, then the icon cell
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

    // Shift+Up / Shift+Down (or Alt+Up / Alt+Down) move the selected entry and the list keeps that order next time
    if ((name == "up" || name == "down") && (shift || keyPress.meta) && !ctrl && this.#suggestBlob != null && allowBindings) {
      this._move(name == "up" ? -1 : 1);
      return true;
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

  private _wantsReorderHint(active: Suggestion | undefined): boolean {
    if (!getConfig().showHints || !this.#navigated || this.#reordered || hasCustomOrder()) return false;
    return active != null && !active.execute && active.type !== "folder" && active.type !== "file";
  }

  private _reorderHint(active: Suggestion | undefined, footerText: string, counter: string, innerWidth: number): string {
    if (!this._wantsReorderHint(active)) return "";
    // only when enough of the description stays readable next to it
    const room = innerWidth - 2 - 1 - wcswidth(counter ? `${reorderHint} · ${counter}` : reorderHint);
    return room >= Math.min(wcswidth(footerText), 16) ? reorderHint : "";
  }

  private _move(direction: -1 | 1) {
    const blob = this.#suggestBlob;
    const items = this._items();
    const from = this.#activeSuggestionIdx;
    const to = from + direction;
    const offset = items.length - (blob?.suggestions.length ?? 0); // the ↪ entry is not part of the suggestions
    const movable = (s: Suggestion | undefined) => s != null && !s.execute && s.type !== "folder" && s.type !== "file";
    if (blob == null || from < 0 || !movable(items.at(from)) || to < 0 || !movable(items.at(to))) return;
    const list = [...blob.suggestions];
    [list[from - offset], list[to - offset]] = [list[to - offset], list[from - offset]];
    this.#suggestBlob = { ...blob, suggestions: list };
    this.#activeSuggestionIdx = to;
    this.#navigated = true;
    this.#reordered = true;
    const names = list.slice(0, Math.max(from, to) - offset + 1).map((s) => s.name);
    const { commandText } = this.#term.getCommandState();
    void this._getRuntime()
      .then((runtime) => runtime.reorderSuggestions?.(commandText ?? "", this.#shell, names))
      .catch((e) => log.debug({ msg: "could not save the order", e: (e as Error).message }));
  }

  private _isStale(): boolean {
    const { commandText } = this.#term.getCommandState();
    const currentKey = commandText ? `${this.#term.cwd}\u0000${getCommandCacheKey(commandText, this.#shell)}` : "";
    return currentKey !== this.#commandKey || this.#inputVersion !== this.#blobInputVersion;
  }

  private _handleEnter(items: Suggestion[]): boolean {
    const suggestion = this.#activeSuggestionIdx >= 0 ? items.at(this.#activeSuggestionIdx) : undefined;
    // `pnpm i` typed in full is already a command (i is install's short name), so Enter runs it as typed
    const token = this.#suggestBlob?.activeToken;
    const typedShortName = token != null && !token.complete && !token.isPath && suggestion?.allNames.includes(token.token) === true;
    if (getConfig().enterAcceptsSuggestion && suggestion != null && !suggestion.execute && !typedShortName && this._accept(suggestion)) {
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
