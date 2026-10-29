// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getConfig } from "../utils/config.js";
import log from "../utils/log.js";
import { gitBashPath, Shell } from "../utils/shell.js";
import { CommandToken, parseCommand } from "./parser.js";
import { buildExecuteShellCommand } from "./utils.js";
import os from "node:os";

const loadedAliases: { [key: string]: CommandToken[] | undefined } = {};
// what each alias expands to, shown as its description in the dropdown
const aliasCommands: { [key: string]: string } = {};
let aliasNames: string[] = [];
const platform = os.platform();
const executeShellCommand = buildExecuteShellCommand(5_000);

const loadBashAliases = async () => {
  const shellTarget = platform == "win32" ? await gitBashPath() : Shell.Bash;
  const { stdout, stderr, status } = await executeShellCommand({
    command: `'${shellTarget}'`,
    args: ["-i", "-c", "alias"],
    cwd: process.cwd(),
    env: { ISTERM: "1" },
  });
  if (status !== 0) {
    log.debug({ msg: "failed to load bash aliases", stderr, status });
    return;
  }

  return stdout
    .trim()
    .split("\n")
    .forEach((line) => {
      const [alias, ...commandSegments] = line.replace("alias ", "").replaceAll("'\\''", "'").split("=");
      aliasCommands[alias] = commandSegments.join("=").slice(1, -1);
      loadedAliases[alias] = parseCommand(aliasCommands[alias] + " ", Shell.Bash);
    });
};

const loadZshAliases = async () => {
  const { stdout, stderr, status } = await executeShellCommand({ command: Shell.Zsh, args: ["-i", "-c", "alias"], cwd: process.cwd(), env: { ISTERM: "1" } });
  if (status !== 0) {
    log.debug({ msg: "failed to load zsh aliases", stderr, status });
    return;
  }

  return stdout
    .trim()
    .split("\n")
    .forEach((line) => {
      const [alias, ...commandSegments] = line.replaceAll("'\\''", "'").split("=");
      // zsh only quotes values that need it (alias gst='git status' but alias ll=ls)
      const raw = commandSegments.join("=");
      aliasCommands[alias] = raw.startsWith("'") && raw.endsWith("'") ? raw.slice(1, -1) : raw;
      loadedAliases[alias] = parseCommand(aliasCommands[alias] + " ", Shell.Zsh);
    });
};

export const loadAliases = async (shell: Shell) => {
  if (!getConfig().useAliases) return;
  switch (shell) {
    case Shell.Bash:
      await loadBashAliases();
      break;
    case Shell.Zsh:
      await loadZshAliases();
      break;
  }
  aliasNames = Object.keys(loadedAliases).sort();
};

export const getAliasNames = () => aliasNames;

export const getAliasCommand = (alias: string): string | undefined => aliasCommands[alias];

export const aliasExpand = (command: CommandToken[]): CommandToken[] => {
  if (!command.at(0)?.complete) return command;

  const alias = loadedAliases[command.at(0)?.token ?? ""];
  if (alias) {
    log.debug({ msg: "expanding alias", alias, command: command.slice(1) });
    return [...alias, ...command.slice(1)];
  }
  return command;
};
