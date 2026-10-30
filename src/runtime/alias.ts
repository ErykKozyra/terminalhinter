// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getConfig } from "../utils/config.js";
import log from "../utils/log.js";
import { gitBashPath, Shell } from "../utils/shell.js";
import { CommandToken, parseCommand } from "./parser.js";
import { buildExecuteShellCommand } from "./utils.js";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { allResourcesPath } from "../utils/constants.js";
import { profileFile } from "../utils/startupBlock.js";

const loadedAliases: { [key: string]: CommandToken[] | undefined } = {};
// what each alias expands to, shown as its description in the dropdown
const aliasCommands: { [key: string]: string } = {};
let aliasNames: string[] = [];
const functionNames = new Set<string>();
const platform = os.platform();
const executeShellCommand = buildExecuteShellCommand(5_000);

const fetchBashAliases = async (): Promise<string | undefined> => {
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
  return stdout;
};

const parseBashAliases = (stdout: string) =>
  stdout
    .trim()
    .split("\n")
    .forEach((line) => {
      const [alias, ...commandSegments] = line.replace("alias ", "").replaceAll("'\\''", "'").split("=");
      aliasCommands[alias] = commandSegments.join("=").slice(1, -1);
      loadedAliases[alias] = parseCommand(aliasCommands[alias] + " ", Shell.Bash);
    });

const functionsMarker = "--- thint functions ---";
// aliases, then your own functions with the file that defines them (zsh keeps that in $functions_source)
const zshListing = `alias; print -r -- '${functionsMarker}'; zmodload zsh/parameter 2>/dev/null; for f in \${(k)functions}; do print -r -- "$f\t\${functions_source[$f]}"; done`;

const fetchZshAliases = async (): Promise<string | undefined> => {
  const { stdout, stderr, status } = await executeShellCommand({
    command: Shell.Zsh,
    args: ["-i", "-c", zshListing],
    cwd: process.cwd(),
    env: { ISTERM: "1" },
  });
  if (status !== 0) {
    log.debug({ msg: "failed to load zsh aliases", stderr, status });
    return;
  }
  return stdout;
};

// functions from plugin managers and frameworks are their internals, not commands you wrote
const isOwnFunction = (name: string, source: string) =>
  /^[A-Za-z][\w.-]*$/.test(name) &&
  source.startsWith(os.homedir() + path.sep) &&
  !/oh-my-zsh|\/plugins\/|\/themes\/|powerlevel10k|zinit|antidote|antigen|zplug|znap|\/\.nvm\/|node_modules|\/\.cache\//.test(source);

const parseZshAliases = (stdout: string) => {
  const [aliasPart, functionPart = ""] = stdout.split(functionsMarker);
  for (const line of functionPart.split("\n")) {
    const [name, source] = line.trim().split("\t");
    if (!name || !source || !isOwnFunction(name, source)) continue;
    aliasCommands[name] = `function from ${source.replace(os.homedir(), "~")}`;
    loadedAliases[name] = undefined;
    functionNames.add(name);
  }
  aliasPart
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

// Listing aliases means starting an interactive shell, which loads your whole config (oh-my-zsh and all) a third
// time per tab. The listing is cached and reused while the shell config is unchanged; an old cache is used right
// away and refreshed in the background.
const cacheFile = () => process.env.THINT_ALIAS_CACHE ?? (process.env.JEST_WORKER_ID ? undefined : path.join(allResourcesPath, "aliases.json"));
const cacheMaxAge = 60 * 60 * 1000; // aliases can also live in files other than .zshrc
type AliasCache = { shell: string; rcMtime: number; at: number; stdout: string };

const rcMtime = (shell: Shell) => {
  const file = profileFile(shell);
  try {
    return file ? fs.statSync(file).mtimeMs : 0;
  } catch {
    return 0;
  }
};

const readCache = (shell: Shell): AliasCache | undefined => {
  const file = cacheFile();
  if (file == null) return;
  try {
    const cache = JSON.parse(fs.readFileSync(file, "utf8")) as AliasCache;
    return cache.shell === shell ? cache : undefined;
  } catch {
    return;
  }
};

const writeCache = (shell: Shell, stdout: string) => {
  const file = cacheFile();
  if (file == null) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ shell, rcMtime: rcMtime(shell), at: Date.now(), stdout } satisfies AliasCache));
  } catch (e) {
    log.debug({ msg: "could not write the alias cache", e: (e as Error).message });
  }
};

const apply = (shell: Shell, stdout: string) => {
  for (const key of Object.keys(loadedAliases)) delete loadedAliases[key];
  for (const key of Object.keys(aliasCommands)) delete aliasCommands[key];
  functionNames.clear();
  if (shell === Shell.Zsh) parseZshAliases(stdout);
  else parseBashAliases(stdout);
  aliasNames = Object.keys(aliasCommands).sort();
};

const refresh = async (shell: Shell) => {
  const stdout = shell === Shell.Zsh ? await fetchZshAliases() : await fetchBashAliases();
  if (stdout == null) return;
  apply(shell, stdout);
  writeCache(shell, stdout);
};

export const loadAliases = async (shell: Shell) => {
  if (!getConfig().useAliases) return;
  if (shell !== Shell.Bash && shell !== Shell.Zsh) return;
  const cache = readCache(shell);
  if (cache != null) {
    apply(shell, cache.stdout);
    const fresh = cache.rcMtime === rcMtime(shell) && Date.now() - cache.at < cacheMaxAge;
    if (!fresh) void refresh(shell).catch((e) => log.debug({ msg: "alias refresh failed", e: (e as Error).message }));
    return;
  }
  await refresh(shell);
};

export const isShellFunction = (name: string) => functionNames.has(name);

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
