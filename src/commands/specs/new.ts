// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { Command } from "commander";

import { customSpecsFolder } from "../../runtime/customSpecs.js";

const template = (name: string) => `# Suggestions for \`${name}\`. Open a new terminal tab after editing.
name: ${name}
description: What ${name} does
subcommands:
  - name: start
    description: Start something
    args:
      name: target
      suggestions: [web, admin]
  - name: logs
    description: Show logs of a service
    args:
      name: service
      # each line printed by the command is a suggestion; "name<TAB>description" adds a description
      script: "ls"
options:
  - name: [--verbose, -v]
    description: Print more details
    isPersistent: true
`;

const cmd = new Command("new")
  .description("create a YAML file with suggestions for your own command")
  .argument("<command>", "the command to describe, e.g. deploy")
  .action((command: string) => {
    const folder = customSpecsFolder();
    const file = path.join(folder, `${command}.yaml`);
    if (fs.existsSync(file)) {
      process.stderr.write(chalk.yellow(`${file} already exists\n`));
      process.exitCode = 1;
      return;
    }
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(file, template(command));
    process.stdout.write(chalk.green("✓") + ` created ${file}\n  edit it, then open a new terminal tab\n`);
  });

export default cmd;
