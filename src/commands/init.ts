// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import chalk from "chalk";
import { Command } from "commander";
import { blockShells, removeStartupBlock } from "../utils/startupBlock.js";
import { createShellConfigs, initSupportedShells as shells, getShellSourceCommand, Shell } from "../utils/shell.js";
import { unpackResources } from "../utils/node.js";
import { render } from "../ui/ui-init.js";
import { runWizard } from "../ui/wizard.js";

const supportedShells = shells.join(", ");

const remove = (shell: string | undefined) => {
  const targets = shell != null ? [shell as Shell] : blockShells;
  const changed = targets.map((s) => removeStartupBlock(s)).filter((f): f is string => f != null);
  if (changed.length === 0) process.stdout.write("no terminalhinter startup lines found\n");
  for (const file of changed) process.stdout.write(chalk.green("✓") + ` removed the startup lines from ${file}\n`);
};

const action = (program: Command) => async (shell: string | undefined, options: { remove?: boolean }) => {
  if (options.remove) return remove(shell);
  await createShellConfigs();
  try {
    await unpackResources();
  } catch (error) {
    program.error(`Failed to unpack resources: ${error instanceof Error ? error.message : String(error)}`, { exitCode: 1 });
  }

  if (shell == null) {
    // in a terminal: a short setup with a live preview; from scripts: the old one-line confirmation
    if (process.stdin.isTTY && process.stdout.isTTY) await runWizard();
    else await render();
    return;
  }
  if (!shells.map((s) => s.valueOf()).includes(shell)) {
    program.error(`Unsupported shell: '${shell}', supported shells: ${supportedShells}`, { exitCode: 1 });
  }
  const config = getShellSourceCommand(shell as Shell);
  process.stdout.write(`\n\n${config}\n`);
};

const cmd = new Command("init");
cmd.description(`set up terminalhinter: without a shell, a short guided setup (shell, theme, icons); with one, prints its startup line`);
cmd.argument("[shell]", `shell to generate plugin for, supported shells: ${supportedShells}`);
cmd.option("--remove", "take the startup lines out of the shell config (zsh, bash, fish)");
cmd.action(action(cmd));

export default cmd;
