// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import chalk from "chalk";
import { deleteCacheFolder } from "../utils/config.js";
import { blockShells, removeStartupBlock } from "../utils/startupBlock.js";

export const render = async () => {
  // the startup lines first, so a new tab never sources a file that is about to disappear
  for (const shell of blockShells) {
    const file = removeStartupBlock(shell);
    if (file) process.stdout.write(chalk.green("✓") + ` removed the startup lines from ${file}\n`);
  }
  deleteCacheFolder();
  process.stdout.write(chalk.green("✓") + " deleted the terminalhinter resources folder (history, bookmarks, your list order)\n");
  process.stdout.write(
    chalk.magenta("•") + " to finish, remove the program: " + chalk.underline(chalk.cyan("npm uninstall -g @erykkozyra/terminalhinter")) + "\n",
  );
};
