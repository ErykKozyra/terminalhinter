// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import chalk from "chalk";
import { Command } from "commander";
import readline from "node:readline/promises";

import { applyMigration, figSpecFolders, installedApps, planMigration } from "../utils/migrate.js";
import { tildify } from "../runtime/extras/util.js";

const action = async (options: { yes?: boolean; dryRun?: boolean }) => {
  const changes = planMigration();
  const apps = installedApps();
  const specFolders = figSpecFolders();

  if (changes.length === 0 && apps.length === 0 && specFolders.length === 0) {
    process.stdout.write(chalk.green("✓") + " nothing from Kiro CLI, Amazon Q or Fig found in your shell files\n");
    return;
  }

  for (const change of changes) {
    process.stdout.write(`${chalk.bold(tildify(change.file))}: ${change.removed.length} line${change.removed.length === 1 ? "" : "s"} to take out\n`);
    for (const line of change.removed) process.stdout.write(chalk.dim(`  - ${line.trim()}\n`));
  }

  if (changes.length > 0 && !options.dryRun) {
    let go = options.yes === true;
    if (!go && process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await rl.question("\nTake these lines out? A copy of each file is kept next to it. [Y/n] ");
      rl.close();
      go = answer.trim() === "" || /^y/i.test(answer.trim());
    }
    if (go) {
      for (const done of applyMigration(changes)) process.stdout.write(chalk.green("✓") + ` ${tildify(done.file)} (copy in ${tildify(done.backup ?? "")})\n`);
    } else process.stdout.write("nothing changed; run thint migrate --yes to do it without asking\n");
  }

  if (specFolders.length > 0) {
    process.stdout.write(`\nYour own Fig specs are in ${specFolders.map((f) => tildify(f)).join(", ")}. To keep them, add to ~/.terminalhinterrc:\n\n`);
    process.stdout.write(chalk.cyan(`  [specs]\n  path = [${specFolders.map((f) => `"${f}"`).join(", ")}]\n`));
  }
  if (apps.length > 0) {
    process.stdout.write(`\nStill installed: ${apps.map((a) => tildify(a)).join(", ")}.\n`);
    process.stdout.write("Quit it from the menu bar, or remove it for good with its own uninstaller (kiro-cli uninstall, q uninstall).\n");
  }
  process.stdout.write(`\nOpen a new terminal tab to start with terminalhinter only.\n`);
};

const cmd = new Command("migrate");
cmd.description("moves you over from Kiro CLI, Amazon Q or Fig: takes their startup lines out of your shell files");
cmd.option("-y, --yes", "take the lines out without asking");
cmd.option("-n, --dry-run", "only show what would change");
cmd.action(action);

export default cmd;
