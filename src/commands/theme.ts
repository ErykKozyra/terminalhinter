// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import chalk from "chalk";
import { Command } from "commander";

import { getConfig, loadConfig, overrideConfig } from "../utils/config.js";
import { writeSetting } from "../utils/configWriter.js";
import { renderPreview } from "../ui/preview.js";
import { PromptCancelled, select } from "../ui/prompt.js";
import { ThemeName, themeNames, themes } from "../ui/theme.js";

const previewOf = async (theme: ThemeName) => {
  overrideConfig({ theme });
  return renderPreview(process.stdout.columns ?? 80);
};

const overrideNote = () => {
  const { activeSuggestionBackgroundColor, borderColor } = getConfig();
  const keys = [activeSuggestionBackgroundColor && "activeSuggestionBackgroundColor", borderColor && "borderColor"].filter(Boolean);
  return keys.length > 0
    ? chalk.yellow(`note: your config sets ${keys.join(" and ")}, which wins over the theme. Remove with: thint config unset <key>\n`)
    : "";
};

const save = (theme: ThemeName) => {
  const file = writeSetting("theme", theme);
  process.stdout.write(chalk.green("✓") + ` theme set to ${chalk.bold(theme)} in ${file}. Open a new terminal tab to see it.\n` + overrideNote());
};

const action = async (name: string | undefined, options: { list?: boolean }) => {
  await loadConfig();
  const current = getConfig().theme;
  if (name != null) {
    if (!themeNames.includes(name as ThemeName)) {
      process.stderr.write(chalk.red(`unknown theme '${name}', available: ${themeNames.join(", ")}\n`));
      process.exitCode = 1;
      return;
    }
    save(name as ThemeName);
    for (const row of await previewOf(name as ThemeName)) process.stdout.write(row + "\n");
    return;
  }
  if (options.list || !process.stdin.isTTY || !process.stdout.isTTY) {
    for (const theme of themeNames) {
      process.stdout.write(`${chalk.bold(theme)}${theme === current ? chalk.green(" (current)") : ""}  ${chalk.dim(themes[theme].description)}\n`);
      for (const row of await previewOf(theme)) process.stdout.write(row + "\n");
      process.stdout.write("\n");
    }
    process.stdout.write(`set one with: thint theme <name>\n`);
    return;
  }
  try {
    const picked = await select({
      title: "Theme",
      choices: themeNames.map((t) => ({ label: t, value: t, hint: themes[t].description + (t === current ? " (current)" : "") })),
      initial: Math.max(themeNames.indexOf(current as ThemeName), 0),
      preview: previewOf,
    });
    save(picked);
  } catch (e) {
    if (e instanceof PromptCancelled) process.stdout.write("theme unchanged\n");
    else throw e;
  }
};

const cmd = new Command("theme");
cmd.description(`pick the colors of the dropdown (${themeNames.join(", ")}), with a live preview`);
cmd.argument("[name]", "theme to use; leave out to pick one with arrow keys");
cmd.option("-l, --list", "print every theme with a preview");
cmd.action(action);

export default cmd;
