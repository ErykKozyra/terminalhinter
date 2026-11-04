// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import chalk from "chalk";
import { getVersion } from "../utils/version.js";

export const renderConfirmation = (live: boolean): string => {
  const statusMessage = live ? chalk.green("live") : chalk.red("not found");
  return `terminalhinter session [${statusMessage}]\n`;
};

export const renderMissingResources = (): string => {
  return chalk.red(`terminalhinter resources out of date, run "thint reinit" to refresh\n`);
};

export const renderUpdateNotice = (latest: string): string => {
  return (
    chalk.dim(`terminalhinter ${latest} is out (you have ${getVersion()}), run `) +
    chalk.bold("thint update") +
    chalk.dim(" to get it\n") +
    chalk.dim("no more of these notes: ") +
    chalk.bold("thint config set updateCheck false") +
    "\n"
  );
};

export const renderUpdated = (): string => {
  return chalk.dim(`terminalhinter is now ${getVersion()}\n`);
};
