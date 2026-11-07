// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import chalk from "chalk";
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";

import { exampleSnippets, loadSnippets, previewSnippet, snippetsFile } from "../runtime/extras/snippets.js";
import { tildify } from "../runtime/extras/util.js";

const list = new Command("list").description("show your snippets").action(() => {
  const { snippets, error } = loadSnippets();
  if (error) {
    process.stderr.write(chalk.red("✗") + ` ${tildify(snippetsFile())}: ${error}\n`);
    process.exitCode = 1;
    return;
  }
  if (snippets.length === 0) {
    process.stdout.write(
      fs.existsSync(snippetsFile())
        ? `no snippets in ${tildify(snippetsFile())}: it should be a list where each entry has a name and a command\n`
        : `no snippets yet: thint snippets new puts a few examples in ${tildify(snippetsFile())}\n`,
    );
    return;
  }
  for (const s of snippets)
    process.stdout.write(`${chalk.bold(s.name)}  ${chalk.dim(previewSnippet(s.command))}${s.description ? `  ${s.description}` : ""}\n`);
});

const create = new Command("new").description("start the snippets file with a few examples").action(() => {
  const file = snippetsFile();
  if (fs.existsSync(file)) {
    process.stdout.write(`${tildify(file)} is already there; edit it to add snippets\n`);
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, exampleSnippets);
  process.stdout.write(chalk.green("✓") + ` wrote ${tildify(file)}: type "rel" in a new line and pick release\n`);
});

const where = new Command("path").description("where the snippets file is").action(() => {
  process.stdout.write(snippetsFile() + "\n");
});

const cmd = new Command("snippets")
  .description("commands with fields to fill in, offered as you type their name")
  .addCommand(list)
  .addCommand(create)
  .addCommand(where);

export default cmd;
