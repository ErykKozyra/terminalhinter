// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import path from "node:path";
import fs from "node:fs";
import chalk from "chalk";
import { Command } from "commander";

import { readBookmarks, tildify, writeBookmarks } from "../runtime/jumps.js";

const add = new Command("add")
  .description("bookmark a folder so `cd` offers it from anywhere")
  .argument("[folder]", "folder to bookmark", ".")
  .option("-n, --name <name>", "name to type after cd (default: the folder name)")
  .action(async (folder: string, options: { name?: string }) => {
    const dir = path.resolve(folder);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      process.stderr.write(chalk.red(`not a folder: ${folder}\n`));
      process.exitCode = 1;
      return;
    }
    const name = options.name ?? path.basename(dir);
    const bookmarks = readBookmarks().filter((b) => b.name !== name && path.resolve(b.path) !== dir);
    bookmarks.push({ name, path: dir });
    await writeBookmarks(bookmarks);
    process.stdout.write(chalk.green("✓") + ` bookmarked ${tildify(dir)} as "${name}"\n`);
  });

const list = new Command("list").description("show your bookmarks").action(() => {
  const bookmarks = readBookmarks();
  if (bookmarks.length === 0) {
    process.stdout.write("no bookmarks yet, add one with: thint bookmark add [folder]\n");
    return;
  }
  const width = Math.max(...bookmarks.map((b) => b.name.length));
  for (const b of bookmarks) process.stdout.write(`${chalk.bold(b.name.padEnd(width))}  ${tildify(b.path)}\n`);
});

const remove = new Command("remove")
  .alias("rm")
  .description("remove a bookmark by name or folder")
  .argument("<name-or-folder>")
  .action(async (target: string) => {
    const dir = path.resolve(target);
    const bookmarks = readBookmarks();
    const kept = bookmarks.filter((b) => b.name !== target && path.resolve(b.path) !== dir);
    if (kept.length === bookmarks.length) {
      process.stderr.write(chalk.red(`no bookmark named or pointing at ${target}\n`));
      process.exitCode = 1;
      return;
    }
    await writeBookmarks(kept);
    process.stdout.write(chalk.green("✓") + ` removed ${target}\n`);
  });

const cmd = new Command("bookmark").description("folders `cd` offers from anywhere").addCommand(add).addCommand(list).addCommand(remove);

export default cmd;
