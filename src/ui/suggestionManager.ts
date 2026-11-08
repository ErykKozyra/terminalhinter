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
import { Field, fillSnippet, snippetFields } from "../runtime/extras/snippets.js";

type SuggestionRuntime = Pick<Awaited<ReturnType<typeof initializeRuntime>>, "getSuggestions"> &
  Partial<
    Pick<
      Awaited<ReturnType<typeof initializeRuntime>>,
      "clearTransientSuggestionState" | "recordExecutedCommand" | "reorderSuggestions" | "getFixes" | "explainCommand" | "rememberWholeCommand"
    >
  >;

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
// edges (2) + entries + separator + up to maxFooterLines of footer + one spare line
const maxFooterLines = 3;
export const getMaxLines = () => getMaxSuggestions() + 4 + maxFooterLines;
export const MIN_WIDTH = minBoxWidth;
export type KeyPressEvent = [string | null | undefined, KeyPress];

type KeyPress = {
  sequence: string;
  name: string;
  ctrl: boolean;
  shift: boolean;
  meta?: boolean;
};

// An entry without a text name (a broken spec or generator) would throw while the list is drawn, inside the code that
// passes the shell's output to the screen; it is left out instead.
const usable = (blob: SuggestionBlob | undefined): SuggestionBlob | undefined =>
  blob == null || !Array.isArray(blob.suggestions)
    ? undefined
    : blob.suggestions.every((s) => s != null && typeof s.name === "string")
    ? blob
    : { ...blob, suggestions: blob.suggestions.filter((s) => s != null && typeof s.name === "string") };

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
  #shownFailureId = 0; // the failed command whose fixes were already offered
  #pendingCommand?: { command: string; cwd: string; failureId?: number }; // ran, waiting to see if it failed
  #explainRequested = false; // Ctrl+G asked what the words of the line mean
  #openedByUser = false; // with showListOn = "tab", the list only appears after Tab or Ctrl+Space
  // filling in the fields of a snippet: the typed text goes into the field, not to the shell
  #fill?: { command: string; fields: Field[]; index: number; values: Record<string, string>; buffer: string; replaceLength: number };

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
    if (this.#fill != null) return false;
    // the fixes belong to the empty line; once you type, they go
    const hadFixes = commandText != null && commandText !== "" && this.#suggestBlob?.mode === "fix";
    if (hadFixes) this.#suggestBlob = undefined;
    if (!commandText) {
      if (commandState.promptText != null) this._rememberFinished();
      this.#openedByUser = false;
      this.#explainRequested = false;
      // the fixes for a command that just failed stay while the line is empty
      if (this.#suggestBlob?.mode === "fix" && !this.#hideSuggestions && !commandState.hasOutput) return false;
      const fixes = await this._loadFixes(commandState.hasOutput === true);
      if (fixes != null) return fixes;
    }
    if (this.#explainRequested && commandText) return this._loadExplanation(commandText, commandKey);
    if (getConfig().showListOn === "tab" && !this.#openedByUser && commandText) {
      const changed = this.#suggestBlob != null || hadFixes;
      this.#suggestBlob = undefined;
      this.#commandKey = "";
      return changed;
    }
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
      this.#suggestBlob = usable(suggestionBlob);
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

  // Right after a command failed, an empty line shows fixes for it, once.
  private async _loadFixes(hasOutput: boolean): Promise<boolean | undefined> {
    const failure = this.#term.getLastFailure?.();
    // wait for the new prompt: zsh redraws it with a clear-below that would wipe a list drawn earlier
    if (this.#term.getCommandState().promptText == null) return;
    if (!getConfig().fixSuggestions || hasOutput || failure == null || failure.id === this.#shownFailureId) return;
    this.#shownFailureId = failure.id;
    const ownVersion = ++this.#requestVersion;
    try {
      const runtime = await this._getRuntime();
      const blob = await runtime.getFixes?.(failure);
      log.debug({ msg: "fixes found", count: blob?.suggestions.length, failure });
      if (blob == null || ownVersion !== this.#requestVersion || this.#term.getCommandState().commandText) return;
      this.#suggestBlob = usable(blob);
      this.#commandKey = "";
      this.#blobInputVersion = this.#inputVersion;
      this._resetSelection();
      return true;
    } catch (e) {
      log.debug({ msg: "could not find fixes", e: (e as Error).message });
      return;
    }
  }

  private async _loadExplanation(commandText: string, commandKey: string): Promise<boolean> {
    this.#explainRequested = false;
    const ownVersion = ++this.#requestVersion;
    try {
      const runtime = await this._getRuntime();
      const blob = await runtime.explainCommand?.(commandText, this.#shell);
      if (ownVersion !== this.#requestVersion) return false;
      this.#suggestBlob = usable(blob);
      this.#commandKey = commandKey;
      this.#blobInputVersion = this.#inputVersion;
      this._resetSelection();
      return true;
    } catch (e) {
      log.debug({ msg: "could not explain the command", e: (e as Error).message });
      return false;
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
    // deletes, force-pushes or looks like production: red, whatever kind of entry it is
    if (suggestion.risk) return style === "plain" ? " " + chalk.hex(ICON_COLORS.execute)("■") + "  " : badge(ICON_COLORS.execute, "!");
    if (suggestion.kind === "recent") return icon(ICON_COLORS.star, NF.star, "↺");
    if (suggestion.kind === "snippet") return icon(ICON_COLORS.subcommand, NF.tag, "{");
    if (suggestion.kind === "fix") return icon(ICON_COLORS.value, NF.star, "✓");
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
  private _argumentHints(suggestion: Suggestion, selected: boolean): boolean {
    const mode = getConfig().argumentHints;
    return suggestion.args != null && suggestion.args.length > 0 && (mode === "all" || (mode === "selected" && selected));
  }

  private _nameWidth(suggestion: Suggestion): number {
    const name = wcswidth(this._displayName(suggestion));
    // with hints on every row they are part of the first column (long ones cut so the descriptions stay in the box)
    if (getConfig().argumentHints !== "all" || !suggestion.args) return name;
    return name + 1 + Math.min(wcswidth(suggestion.args), maxArgsWidth);
  }

  // where each part of a row goes: the name, its argument hints, then the description starting at the name column
  // (or right after the hints when they are longer, which only happens on the selected row)
  private _layoutRow(suggestion: Suggestion, selected: boolean, innerWidth: number, nameColumn: number) {
    const textWidth = innerWidth - 2 - iconWidth - 1; // inset bar, icon cell, one space at the right end
    const column = Math.min(nameColumn, textWidth);
    const [shownName, nameTruncated] = fitText(this._displayName(suggestion), Math.max(column, Math.min(wcswidth(this._displayName(suggestion)), textWidth)));
    const description = this._inlineDescription(suggestion);
    let args = "";
    if (!nameTruncated && this._argumentHints(suggestion, selected)) {
      const all = getConfig().argumentHints === "all";
      const room = all ? column - wcswidth(shownName) - 1 : textWidth - wcswidth(shownName) - 1 - (description ? 24 : 0);
      if (room > 4) args = fitText(suggestion.args ?? "", room)[0];
    }
    const firstWidth = wcswidth(shownName) + (args ? 1 + wcswidth(args) : 0);
    const descStart = Math.max(column, firstWidth);
    const descWidth = textWidth - descStart - 2;
    const shownDescription = description && descWidth >= 6 ? fitText(description, descWidth)[0] : "";
    const fits = description.length > 0 && descWidth >= 6 && wcswidth(description) <= descWidth;
    return { textWidth, shownName, args, firstWidth, descStart, shownDescription, fits };
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
    const { textWidth, shownName, args, firstWidth, descStart, shownDescription } = this._layoutRow(suggestion, selected, innerWidth, nameColumn);
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
      content += " ".repeat(descStart - firstWidth) + "  " + dim(shownDescription);
      contentWidth = descStart + 2 + wcswidth(shownDescription);
    }
    const bar = this._icon(suggestion, selected) + content + " ".repeat(Math.max(textWidth - contentWidth, 0)) + " ";
    return " " + (selected ? chalk.bgHex(theme.selection)(bar) : bar) + " ";
  }

  // true when the row shows the whole description, so the footer does not have to repeat it
  private _footerLines(active: Suggestion | undefined, argumentDescription: string | undefined, innerWidth: number, nameColumn: number): string[] {
    const width = innerWidth - 2;
    const lines = this._footerLinesWithoutRisk(active, argumentDescription, innerWidth, nameColumn);
    if (active?.risk) return [...wrapText(`⚠ ${active.risk}`, width, 2), ...lines].slice(0, maxFooterLines);
    return lines;
  }

  private _footerLinesWithoutRisk(active: Suggestion | undefined, argumentDescription: string | undefined, innerWidth: number, nameColumn: number): string[] {
    const width = innerWidth - 2;
    const mode = this.#suggestBlob?.mode;
    if (active == null && mode === "fix") return ["the last command failed · tab puts the fix on the line · esc hides it"];
    if (active == null && mode === "explain") {
      const notes = this.#suggestBlob?.notes ?? [];
      return notes.length > 0 ? notes.flatMap((n) => wrapText(`⚠ ${n}`, width, 1)) : ["what each word does · ↑↓ to read more · esc closes"];
    }
    if (mode === "fill" && this.#fill != null) {
      const current = this.#fill.fields[this.#fill.index];
      const preview = fillSnippet(this.#fill.command, { ...this.#fill.values, [current?.name ?? ""]: this.#fill.buffer || current?.default || "…" });
      return [...wrapText(preview, width, 2), "tab next field · enter when done · esc cancels"];
    }
    if (active == null) return argumentDescription ? [argumentDescription] : [];
    // the ↪ entry has no description column, so what it does goes in the footer
    if (active.execute) return active.description ? wrapText(active.description, width, maxFooterLines) : [];
    const layout = this._layoutRow(active, true, innerWidth, nameColumn);
    const description = this._inlineDescription(active);
    const argsCut = getConfig().argumentHints !== "none" && active.args != null && active.args.length > 0 && layout.args !== active.args;
    const descCut = description.length > 0 && !layout.fits;
    if (!argsCut && !descCut) return argumentDescription ? [argumentDescription] : [];
    const lines: string[] = [];
    if (argsCut) lines.push(...wrapText(`${this._displayName(active)} ${active.args}`, width, descCut ? 1 : maxFooterLines));
    if (descCut) lines.push(...wrapText(description, width, maxFooterLines - lines.length));
    return lines;
  }

  private _descriptionFits(suggestion: Suggestion, innerWidth: number, nameColumn: number, selected = true): boolean {
    return this._layoutRow(suggestion, selected, innerWidth, nameColumn).fits;
  }

  private _renderFooter(text: string, counter: string, innerWidth: number): string {
    const counterWidth = counter ? wcswidth(counter) + 1 : 0;
    const [shown] = fitText(text, innerWidth - 2 - counterWidth);
    const gap = innerWidth - 2 - wcswidth(shown) - counterWidth;
    const theme = activeTheme();
    return " " + chalk.italic.hex(theme.footer)(shown) + " ".repeat(Math.max(gap, 0)) + (counter ? " " + chalk.hex(theme.counter)(counter) : "") + " ";
  }
  // the fixes for a failed command are the one list shown on an empty line
  showsOnEmptyLine(): boolean {
    return this.#suggestBlob?.mode === "fix";
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
    // the box needs two lines for its edges, so in a very short terminal the footer goes first, then the edges, and at
    // least one entry stays (the terminal already keeps a line free below the prompt, see remainingLines in pty.ts)
    const room = maxLines;
    const compact = room < 3; // no room for the edges: only the entries
    // a warning about the line matters more than one more row
    const warns = (this.#suggestBlob.mode === "explain" && (this.#suggestBlob.notes?.length ?? 0) > 0) || this.#suggestBlob.mode === "fill";
    const maxSuggestions = compact ? Math.max(room, 1) : Math.max(1, Math.min(getMaxSuggestions(), room - (warns ? 5 : 2)));
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
    // the snippet form shows the whole command under its fields, so it gets room for it
    const formWidth = this.#suggestBlob.mode === "fill" ? 64 : 0;
    const width = Math.max(Math.min(Math.max(widest + 2, minBoxWidth, hintWidth, formWidth), maxWidth), Math.min(minBoxWidth, maxWidth));
    const innerWidth = width - 2;

    const rows: string[] = [];
    let footerRows = 0;
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
      // the footer shows in full whatever the selected row had to cut: its argument hints and its description,
      // wrapped over up to three lines
      const footerLines = this._footerLines(active, argumentDescription, innerWidth, nameColumn);
      const shownFooter = footerLines.at(0) ?? "";
      // while you walk the list, a short hint tells that the order can be changed; it stops once you have done it
      const hint = footerLines.length <= 1 ? this._reorderHint(active, shownFooter, counter, innerWidth) : "";
      if (footerLines.length > 1) {
        footerRows = 1 + footerLines.length;
        rows.push(edge("├", "┤", true));
        for (const line of footerLines) rows.push(border("│") + panel(this._renderFooter(line, "", innerWidth)) + border("│"));
        if (counter && innerWidth >= wcswidth(counter) + 4) {
          const fill = innerWidth - wcswidth(counter) - 3;
          rows[0] = border(tl + "─".repeat(fill) + " ") + chalk.hex(activeTheme().counter)(counter) + border(" ─" + tr);
        }
      } else if (shownFooter || hint) {
        footerRows = 2;
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

    let shown = rows;
    // too tall: drop footer lines from the bottom first, then the whole footer
    while (shown.length > room && footerRows > 2) {
      shown = [...shown.slice(0, shown.length - 2), shown[shown.length - 1]];
      footerRows -= 1;
    }
    if (shown.length > room && footerRows > 0) {
      shown = [...shown.slice(0, shown.length - 1 - footerRows), shown[shown.length - 1]];
      if (counter && innerWidth >= wcswidth(counter) + 4) {
        const fill = innerWidth - wcswidth(counter) - 3;
        shown[0] = border(tl + "─".repeat(fill) + " ") + chalk.hex(activeTheme().counter)(counter) + border(" ─" + tr);
      }
    }
    if (compact || shown.length > room) shown = rows.slice(1, 1 + Math.min(visible.length, Math.max(room, 1))); // no edges, only the entries
    if (shown.length > room) return [];
    return shown.map((data) => ({ startX, length: width, data }));
  }
  // text reached the shell without going through update (a paste), so the list on screen no longer belongs to the line
  noteInput(): void {
    this.#inputVersion += 1;
  }

  update(keyPress: KeyPress, allowBindings = true): boolean {
    const handled = this._update(keyPress, allowBindings);
    // a key that went to the shell changes the line, so the list on screen no longer belongs to it
    if (!handled && keyPress.name != "return") this.#inputVersion += 1;
    return handled;
  }

  private _update(keyPress: KeyPress, allowBindings: boolean): boolean {
    const { name, shift, ctrl } = keyPress;

    if (this.#fill != null) return this._updateFill(keyPress);

    // Ctrl+J (a bare line feed) runs the line in zsh, bash and fish, as typed
    if (name == "enter" && keyPress.sequence === "\n" && !ctrl && (this.#shell == Shell.Zsh || this.#shell == Shell.Bash || this.#shell == Shell.Fish)) {
      this.#suggestBlob = undefined;
      this._recordExecution();
      this.#term.clearCommand();
      return false;
    }

    // Ctrl+G: what each word of the line does; again to close
    if (ctrl && name == "g") {
      if (this.#suggestBlob?.mode === "explain") {
        this.#suggestBlob = undefined;
        this.#hideSuggestions = true;
      } else if (this.#term.getCommandState().commandText) {
        this.#explainRequested = true;
        this.#hideSuggestions = false;
        this.#commandKey = "";
        this.#refreshRequested = true;
      } else return false;
      return true;
    }
    if (this.#suggestBlob?.mode === "explain") {
      const { nextSuggestion, previousSuggestion, dismissSuggestions } = getConfig().bindings;
      if (name == nextSuggestion.key || name == previousSuggestion.key) {
        const count = this.#suggestBlob.suggestions.length;
        this.#navigated = true;
        this.#activeSuggestionIdx = Math.max(-1, Math.min(this.#activeSuggestionIdx + (name == nextSuggestion.key ? 1 : -1), count - 1));
        return true;
      }
      // any other key closes it and does what it always does
      this.#suggestBlob = undefined;
      if (name == dismissSuggestions.key) {
        this.#hideSuggestions = true;
        return true;
      }
      this.#commandKey = "";
      if (name == "return") {
        this._recordExecution();
        this.#term.clearCommand();
      }
      return false;
    }
    // showListOn = "tab": Tab opens the list for the word being typed
    if (name == "tab" && !shift && !ctrl && this.#suggestBlob == null && getConfig().showListOn === "tab" && this.#term.getCommandState().commandText) {
      this.#openedByUser = true;
      this.#hideSuggestions = false;
      this.#commandKey = "";
      this.#refreshRequested = true;
      return true;
    }

    // Ctrl+Space (sent as ^@, which readline names "`") opens the list on demand, or closes it when it is open
    if (ctrl && (name == "`" || name == "space")) {
      if (this.#suggestBlob != null && allowBindings) {
        this.#suggestBlob = undefined;
        this.#hideSuggestions = true;
      } else {
        this.#hideSuggestions = false;
        this.#commandKey = "";
        this.#openedByUser = true;
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
    } else if (name == "tab" && !shift && !ctrl && getConfig().tabBehavior === "shell" && this.#suggestBlob.mode == null) {
      if (!this._shellTab(items)) return false;
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

  // Like a shell: Tab adds the part all entries share; when nothing more is shared, it walks down the list, and with
  // a single entry it accepts it.
  private _shellTab(items: Suggestion[]): boolean {
    const entries = items.filter((s) => !s.execute);
    if (entries.length === 0) return false;
    if (entries.length === 1) return this._accept(entries[0]);
    const partial = this._partialText();
    const names = entries.map((s) => s.insertValue?.trimEnd() ?? s.name);
    let common = names[0];
    for (const n of names) {
      let i = 0;
      while (i < common.length && i < n.length && common[i] === n[i]) i++;
      common = common.slice(0, i);
    }
    const token = this.#suggestBlob?.activeToken;
    const typed = token != null && !token.complete ? token.token : "";
    if (common.length > typed.length && common.startsWith(typed) && !token?.isPath) {
      this.#term.write(common.slice(typed.length));
      return true;
    }
    if (partial.length > 0 && common.length > partial.length && token?.isPath && common.startsWith(partial)) {
      this.#term.write(common.slice(partial.length));
      return true;
    }
    this.#navigated = true;
    this.#activeSuggestionIdx = (this.#activeSuggestionIdx + 1) % items.length;
    if (items.at(this.#activeSuggestionIdx)?.execute) this.#activeSuggestionIdx = (this.#activeSuggestionIdx + 1) % items.length;
    return true;
  }

  // a snippet without fields goes on the line at once; with fields, the list asks for each of them first
  private _startSnippet(command: string): boolean {
    const token = this.#suggestBlob?.activeToken;
    const replaceLength = token != null && !token.complete ? token.tokenLength : 0;
    const fields = snippetFields(command);
    if (fields.length === 0) {
      this.#term.write("\u007F".repeat(replaceLength) + fillSnippet(command, {}));
      return true;
    }
    this.#fill = { command, fields, index: 0, values: {}, buffer: "", replaceLength };
    this._showFill();
    return true;
  }

  private _showFill() {
    const fill = this.#fill;
    if (fill == null) return;
    this.#suggestBlob = {
      mode: "fill",
      suggestions: fill.fields.map((f, i) => ({
        name: f.name,
        allNames: [f.name],
        icon: "✂",
        kind: "snippet",
        priority: 0,
        description:
          i === fill.index
            ? fill.buffer
              ? `${fill.buffer}▏`
              : `▏${f.default ? ` ${f.default} if you leave it empty` : ""}`
            : fill.values[f.name] || (f.default ? `${f.default} (default)` : ""),
      })),
    };
    this.#activeSuggestionIdx = fill.index;
    this.#scrollTop = 0;
  }

  private _updateFill(keyPress: KeyPress): boolean {
    const fill = this.#fill!;
    const { name, ctrl, sequence } = keyPress;
    if (name == "escape" || (ctrl && name == "c")) {
      this.#fill = undefined;
      this.#suggestBlob = undefined;
      this.#hideSuggestions = true;
      // Ctrl+C also clears the line, as it always does
      return !(ctrl && name == "c");
    }
    if (name == "tab" || name == "return" || (name == "down" && !ctrl)) {
      fill.values[fill.fields[fill.index].name] = fill.buffer || fill.fields[fill.index].default || "";
      if (fill.index + 1 < fill.fields.length && !(name == "return" && keyPress.shift)) {
        fill.index += 1;
        const next = fill.fields[fill.index];
        fill.buffer = fill.values[next.name] ?? "";
        this._showFill();
        return true;
      }
      // every field filled: the finished command replaces the snippet name on the line, ready to run
      this.#fill = undefined;
      this.#suggestBlob = undefined;
      this.#hideSuggestions = true;
      this.#term.write("\u007F".repeat(fill.replaceLength) + fillSnippet(fill.command, fill.values));
      return true;
    }
    if (name == "up" && fill.index > 0) {
      fill.values[fill.fields[fill.index].name] = fill.buffer;
      fill.index -= 1;
      fill.buffer = fill.values[fill.fields[fill.index].name] ?? "";
    } else if (name == "backspace") {
      fill.buffer = [...fill.buffer].slice(0, -1).join("");
    } else if (ctrl && name == "u") {
      fill.buffer = "";
    } else if (!ctrl && sequence && sequence.length > 0 && !sequence.startsWith("\u001b") && sequence >= " ") {
      fill.buffer += sequence;
    }
    this._showFill();
    return true;
  }

  private _wantsReorderHint(active: Suggestion | undefined): boolean {
    if (!getConfig().showHints || !this.#navigated || this.#reordered || hasCustomOrder() || this.#suggestBlob?.mode != null) return false;
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

  // A whole command goes into the history entries once the next prompt shows it did not fail.
  private _rememberFinished() {
    const pending = this.#pendingCommand;
    if (pending == null) return;
    this.#pendingCommand = undefined;
    const failure = this.#term.getLastFailure?.();
    if (failure != null && failure.id !== pending.failureId && failure.command === pending.command) return;
    void this._getRuntime()
      .then((runtime) => runtime.rememberWholeCommand?.(pending.command, pending.cwd))
      .catch((e) => log.debug({ msg: "could not remember the command", e: (e as Error).message }));
  }

  // feeds the frecency ranking; only what was typed at the prompt, never program output
  private _recordExecution() {
    const { commandText, hasOutput } = this.#term.getCommandState();
    if (!commandText || hasOutput) return;
    const cwd = this.#term.cwd;
    this.#pendingCommand = { command: commandText.trim(), cwd, failureId: this.#term.getLastFailure?.()?.id };
    void this._getRuntime()
      .then((runtime) => runtime.recordExecutedCommand?.(commandText, cwd, this.#shell))
      .catch((e) => log.debug({ msg: "could not record command", e: (e as Error).message }));
  }

  private _accept(suggestion: Suggestion | undefined): boolean {
    if (suggestion == null || suggestion.execute || suggestion.kind === "explain") return false;
    if (suggestion.snippet != null) return this._startSnippet(suggestion.snippet);
    const action = calculateReplacement(this.#suggestBlob?.activeToken, suggestion);
    if (action == null) return false;
    const token = this.#suggestBlob?.activeToken;
    if (token != null && action.backspaceCount === token.tokenLength && action.insertText.trimEnd() === token.token) return false; // already typed in full, so Enter runs it
    this.#term.write(applyReplacement(action));
    return true;
  }
}

// Breaks text into lines at spaces; the last allowed line ends in an ellipsis when something is left over.
const wrapText = (text: string, width: number, maxLines: number): string[] => {
  if (maxLines <= 0 || width <= 0) return [];
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (wcswidth(next) <= width) {
      line = next;
      continue;
    }
    if (lines.length === maxLines - 1) {
      // the last line takes the rest, cut to fit
      lines.push(fitText(words.slice(line ? i - line.split(" ").length : i).join(" "), width)[0]);
      return lines;
    }
    if (line) lines.push(line);
    line = words[i];
  }
  if (line) lines.push(fitText(line, width)[0]);
  return lines.slice(0, maxLines);
};

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
