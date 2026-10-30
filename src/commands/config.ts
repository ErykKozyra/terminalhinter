// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import chalk from "chalk";
import { Command } from "commander";

import { getConfig, loadConfig } from "../utils/config.js";
import { activeConfigPath, describeKey, parseValue, settableKeys, writeSetting } from "../utils/configWriter.js";

const fail = (message: string) => {
  process.stderr.write(chalk.red(message + "\n"));
  process.exitCode = 1;
};

const show = new Command("list")
  .alias("ls")
  .description("show every setting and its current value")
  .action(async () => {
    await loadConfig();
    const config = getConfig() as unknown as Record<string, unknown>;
    const width = Math.max(...settableKeys.map((k) => k.length));
    for (const key of settableKeys) {
      const value = config[key];
      const shown = value === undefined ? chalk.dim("(theme)") : chalk.cyan(String(value));
      process.stdout.write(`${key.padEnd(width)}  ${shown}  ${chalk.dim(describeKey(key))}\n`);
    }
    process.stdout.write(chalk.dim(`\nfile: ${activeConfigPath()}\n`));
  });

const get = new Command("get")
  .description("print one setting")
  .argument("<key>", "setting name")
  .action(async (key: string) => {
    await loadConfig();
    if (!settableKeys.includes(key)) return fail(`unknown setting '${key}', settable: ${settableKeys.join(", ")}`);
    const value = (getConfig() as unknown as Record<string, unknown>)[key];
    process.stdout.write(`${value ?? ""}\n`);
  });

const set = new Command("set")
  .description("change one setting, e.g. thint config set maxSuggestions 8")
  .argument("<key>", "setting name")
  .argument("<value>", "new value")
  .action((key: string, raw: string) => {
    try {
      const file = writeSetting(key, parseValue(key, raw));
      process.stdout.write(chalk.green("✓") + ` ${key} = ${raw} (${file}). Open a new terminal tab to see it.\n`);
    } catch (e) {
      fail((e as Error).message);
    }
  });

const unset = new Command("unset")
  .description("go back to the default of one setting")
  .argument("<key>", "setting name")
  .action((key: string) => {
    if (!settableKeys.includes(key)) return fail(`unknown setting '${key}', settable: ${settableKeys.join(", ")}`);
    try {
      const file = writeSetting(key, undefined);
      process.stdout.write(chalk.green("✓") + ` ${key} back to default (${file})\n`);
    } catch (e) {
      fail((e as Error).message);
    }
  });

const where = new Command("path").description("print the config file location").action(() => {
  process.stdout.write(activeConfigPath() + "\n");
});

const cmd = new Command("config");
cmd.description("show or change settings without opening the config file");
cmd.addCommand(show);
cmd.addCommand(get);
cmd.addCommand(set);
cmd.addCommand(unset);
cmd.addCommand(where);

export default cmd;
