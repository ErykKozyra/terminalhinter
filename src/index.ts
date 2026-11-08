#!/usr/bin/env node

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable header/header */

import { Command, Option } from "commander";

import complete from "./commands/complete.js";
import reinit from "./commands/reinit.js";
import uninstall from "./commands/uninstall.js";
import init from "./commands/init.js";
import specs from "./commands/specs/root.js";
import doctor from "./commands/doctor.js";
import bookmark from "./commands/bookmark.js";
import theme from "./commands/theme.js";
import order from "./commands/order.js";
import config from "./commands/config.js";
import update from "./commands/update.js";
import migrate from "./commands/migrate.js";
import snippets from "./commands/snippets.js";
import debug from "./commands/debug.js";
import { action, supportedShells } from "./commands/root.js";
import { getVersion } from "./utils/version.js";

// `thint theme --list | head` closes the pipe early; that is not an error
process.stdout.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code === "EPIPE") process.exit(0);
  throw e;
});

const program = new Command();

const hiddenOption = (flags: string, description: string) => {
  const option = new Option(flags, description);
  option.hidden = true;
  return option;
};

program
  .name("thint")
  .description("Kiro-style terminal autocomplete (terminalhinter)")
  .version(getVersion(), "-v, --version", "output the current version")
  .action(action(program))
  .option("-l, --login", `start shell as a login shell`)
  .option("-s, --shell <shell>", `shell to use for command execution, supported shells: ${supportedShells}`)
  .option("-c, --check", `check if the shell is in a terminalhinter session`)
  .addOption(hiddenOption("-T, --test", "used to make e2e tests reproducible across machines"))
  .option("-V, --verbose", `enable verbose logging`)
  .passThroughOptions();

program.addCommand(init);
program.addCommand(reinit);
program.addCommand(bookmark);
program.addCommand(theme);
program.addCommand(order);
program.addCommand(config);
program.addCommand(doctor);
program.addCommand(update);
program.addCommand(migrate);
program.addCommand(snippets);
program.addCommand(debug);
program.addCommand(specs);
program.addCommand(complete);
program.addCommand(uninstall);

program.parse();
