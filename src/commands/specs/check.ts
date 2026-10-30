// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import chalk from "chalk";
import { Command } from "commander";

import { customSpecsFolder, loadCustomSpecs } from "../../runtime/customSpecs.js";

const cmd = new Command("check").description("validate your own YAML/JSON suggestion files").action(() => {
  const { specs, errors } = loadCustomSpecs();
  process.stdout.write(`folder: ${customSpecsFolder()}\n`);
  for (const name of [...specs.keys()].sort()) process.stdout.write(chalk.green("✓") + ` ${name}\n`);
  for (const { file, message } of errors) process.stdout.write(chalk.red("✗") + ` ${file}: ${message}\n`);
  if (specs.size === 0 && errors.length === 0) process.stdout.write("no files yet, create one with: thint specs new <command>\n");
  if (errors.length > 0) process.exitCode = 1;
});

export default cmd;
