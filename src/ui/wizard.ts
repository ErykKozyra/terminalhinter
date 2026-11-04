// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// `thint init` in a terminal: pick the shell, theme and icons with a live preview, then put the startup lines at the
// top of the shell config.

import os from "node:os";
import path from "node:path";
import chalk from "chalk";

import { getConfig, loadConfig, overrideConfig } from "../utils/config.js";
import { writeSetting } from "../utils/configWriter.js";
import { getShellSourceCommand, initSupportedShells, Shell } from "../utils/shell.js";
import { blockShells, installStartupBlock, profileFile } from "../utils/startupBlock.js";
import { renderPreview } from "./preview.js";
import { PromptCancelled, select } from "./prompt.js";
import { ThemeName, themeNames, themes } from "./theme.js";

type IconStyle = "plain" | "marks" | "badge" | "nerd";
const iconStyles: { value: IconStyle; hint: string }[] = [
  { value: "plain", hint: "colored squares, works with every font" },
  { value: "marks", hint: "a symbol per kind ($ for commands, - for options)" },
  { value: "badge", hint: "marks on small colored squares" },
  { value: "nerd", hint: "needs a Nerd Font in your terminal" },
];

const tildify = (file: string) => (file.startsWith(os.homedir() + path.sep) ? "~" + file.slice(os.homedir().length) : file);
const preview = () => renderPreview(process.stdout.columns ?? 80);

export const runWizard = async () => {
  await loadConfig();
  const out = (text: string) => process.stdout.write(text);
  out(`\n${chalk.bold("terminalhinter setup")} ${chalk.dim("· Esc to quit, nothing is written until the end")}\n\n`);

  try {
    const detected = path.basename(process.env.SHELL ?? "") as Shell;
    const shells = [...initSupportedShells].sort((a, b) => Number(b === detected) - Number(a === detected));
    const shell = await select({
      title: "Shell",
      choices: shells.map((s) => ({ label: s, value: s, hint: s === detected ? "your login shell" : undefined })),
    });

    const startTheme = getConfig().theme as ThemeName;
    const theme = await select({
      title: "Theme",
      choices: themeNames.map((t) => ({ label: t, value: t, hint: themes[t].description })),
      initial: Math.max(themeNames.indexOf(startTheme), 0),
      preview: (t) => {
        overrideConfig({ theme: t });
        return preview();
      },
    });
    overrideConfig({ theme });

    const iconStyle = await select({
      title: "Icons",
      choices: iconStyles.map((s) => ({ label: s.value, value: s.value, hint: s.hint })),
      initial: Math.max(
        iconStyles.findIndex((s) => s.value === getConfig().iconStyle),
        0,
      ),
      preview: (style) => {
        overrideConfig({ iconStyle: style });
        return preview();
      },
    });

    const file = blockShells.includes(shell) ? profileFile(shell) : undefined;
    const editProfile =
      file != null &&
      (await select({
        title: `Put the startup lines at the top of ${tildify(file)}?`,
        choices: [
          { label: "Yes", value: true, hint: "a backup of the file is kept" },
          { label: "No", value: false, hint: "just show me the line" },
        ],
      }));

    const configFile = writeSetting("theme", theme);
    writeSetting("iconStyle", iconStyle, configFile);
    out(`\n${chalk.green("✓")} saved theme and icons in ${tildify(configFile)}\n`);
    if (editProfile) {
      const { file: written, backup } = installStartupBlock(shell);
      out(`${chalk.green("✓")} startup lines are at the top of ${tildify(written)}${backup ? chalk.dim(` (backup: ${tildify(backup)})`) : ""}\n`);
    } else {
      out(`\nAdd this as the first line of your ${shell} config:\n\n  ${getShellSourceCommand(shell).trim()}\n`);
    }
    out(`\nDone. Open a new terminal tab.\n`);
    out(
      [
        "",
        chalk.bold("Keys in the list"),
        `  ${chalk.cyan("Enter")}            accept; on a folder walk into it; on ↪ run the command`,
        `  ${chalk.cyan("↑ ↓")}              move the selection`,
        `  ${chalk.cyan("Shift+↑ ↓")}        move the selected entry; the list keeps your order`,
        `  ${chalk.cyan("Esc / Ctrl+Space")} close the list / open it again`,
        "",
      ].join("\n"),
    );
  } catch (e) {
    if (e instanceof PromptCancelled) {
      out(`\nSetup cancelled, nothing was changed.\n`);
      return;
    }
    throw e;
  }
};
