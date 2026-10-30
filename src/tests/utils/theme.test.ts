// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import toml from "toml";

import { overrideConfig } from "../../utils/config.js";
import { parseValue, setInToml, writeSetting } from "../../utils/configWriter.js";
import { startupBlock, withStartupBlock, beginMark, endMark } from "../../utils/startupBlock.js";
import { activeTheme, themeNames, themes } from "../../ui/theme.js";
import { renderPreview } from "../../ui/preview.js";
import { Shell } from "../../utils/shell.js";

afterEach(() => overrideConfig({ theme: "thint", activeSuggestionBackgroundColor: undefined, borderColor: undefined, iconStyle: "plain" }));

test("every theme defines every color as #RRGGBB", () => {
  const hexes = (value: unknown): string[] =>
    typeof value === "string" ? [value] : Object.entries(value as object).flatMap(([k, v]) => (k === "description" ? [] : hexes(v)));
  for (const name of themeNames) for (const hex of hexes(themes[name])) expect(hex).toMatch(/^#[0-9A-F]{6}$/i);
});

test("colors set in the config win over the theme", () => {
  overrideConfig({ theme: "nord" });
  expect(activeTheme().selection).toBe(themes.nord.selection);
  overrideConfig({ activeSuggestionBackgroundColor: "#123456" });
  expect(activeTheme().selection).toBe("#123456");
  expect(activeTheme().border).toBe(themes.nord.border);
});

test("the preview draws the dropdown in the theme colors", async () => {
  const chalk = (await import("chalk")).default;
  const level = chalk.level;
  chalk.level = 3;
  overrideConfig({ theme: "dracula" });
  const rows = await renderPreview(80);
  chalk.level = level;
  // eslint-disable-next-line no-control-regex
  expect(rows.join("\n").replace(/\x1b\[[0-9;]*m/g, "")).toContain("checkout [branch]");
  expect(rows.join("\n")).toContain("\x1b[48;2;98;114;164m"); // dracula selection #6272A4
});

test("a new top-level setting goes above the first [section]", () => {
  const text = 'maxSuggestions = 8\n\n[bindings.acceptSuggestion]\nkey = "tab"\n';
  const result = setInToml(text, "theme", "nord");
  expect(result).toBe('maxSuggestions = 8\ntheme = "nord"\n\n[bindings.acceptSuggestion]\nkey = "tab"\n');
  expect(toml.parse(result).theme).toBe("nord");
  expect(setInToml(result, "theme", "light")).toContain('theme = "light"\n\n[bindings');
  expect(setInToml(result, "theme", undefined)).toBe(text);
  expect(setInToml("", "fuzzyMatching", false)).toBe("fuzzyMatching = false\n");
});

test("values are checked before anything is written", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thint-config-"));
  const file = path.join(dir, "rc");
  expect(() => writeSetting("theme", "neon", file)).toThrow(/invalid value/);
  expect(fs.existsSync(file)).toBe(false);
  writeSetting("maxSuggestions", parseValue("maxSuggestions", "9"), file);
  expect(fs.readFileSync(file, "utf8")).toBe("maxSuggestions = 9\n");
  expect(() => parseValue("fuzzyMatching", "yes")).toThrow(/true or false/);
  expect(() => parseValue("nope", "1")).toThrow(/unknown setting/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the startup block replaces an older one and loose startup lines, and goes first", () => {
  const block = startupBlock(Shell.Zsh, "/home/me/.local/bin", "/home/me");
  expect(block.split("\n")[1]).toBe('export PATH="$HOME/.local/bin:$PATH"');
  const old = `export A=1\n${beginMark}\nold stuff\n${endMark}\n\n[[ -f ~/.local/share/inshellisense/init/zsh/init.zsh ]] && source x\nexport B=2\n`;
  const result = withStartupBlock(old, block, Shell.Zsh);
  expect(result.startsWith(block + "\n")).toBe(true);
  expect(result).not.toContain("old stuff");
  expect(result).not.toContain("inshellisense");
  expect(result.endsWith("export A=1\nexport B=2\n")).toBe(true);
  expect(withStartupBlock(result, block, Shell.Zsh)).toBe(result);
});

test("files are tinted by kind", async () => {
  const chalk = (await import("chalk")).default;
  const level = chalk.level;
  chalk.level = 3;
  const { SuggestionManager } = await import("../../ui/suggestionManager.js");
  const { Shell } = await import("../../utils/shell.js");
  const files = ["a.ts", "pnpm-lock.yaml", "b.json"].map((name) => ({ name, allNames: [name], icon: "📄", priority: 55, type: "file" as const }));
  const terminal = {
    cwd: process.cwd(),
    cols: 80,
    getCommandState: () => ({ commandText: "ls ", cursorTerminated: true, hasOutput: false }),
    getCursorState: () => ({ cursorX: 0 }),
    write: () => {},
    clearCommand: () => {},
  } as unknown as import("../../isterm/pty.js").ISTerm;
  const manager = new SuggestionManager(terminal, Shell.Zsh, Promise.resolve({ getSuggestions: async () => ({ suggestions: files }) }));
  await manager.exec();
  const rows = manager.render("below", 3).map((r) => r.data);
  chalk.level = level;
  const rgb = (hex: string) => `38;2;${parseInt(hex.slice(1, 3), 16)};${parseInt(hex.slice(3, 5), 16)};${parseInt(hex.slice(5, 7), 16)}m`;
  expect(rows[1]).toContain(rgb(themes.thint.icons.alias)); // code
  expect(rows[2]).toContain(rgb(themes.thint.icons.file)); // lock file stays plain
  expect(rows[3]).toContain(rgb(themes.thint.icons.star)); // config
});
