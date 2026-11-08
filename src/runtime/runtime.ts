// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import figSpecList, {
  diffVersionedCompletions as figVersionedSpeclist,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
} from "@withfig/autocomplete";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseCommand, CommandToken } from "./parser.js";
import { getArgDrivenRecommendation, getSubcommandDrivenRecommendation, SuggestionIcons } from "./suggestion.js";
import { Suggestion, SuggestionBlob } from "./model.js";
import { buildExecuteShellCommand, resolveCwd } from "./utils.js";
import { Shell } from "../utils/shell.js";
import { aliasExpand, getAliasNames, getAliasCommand } from "./alias.js";
import { getConfig } from "../utils/config.js";
import log from "../utils/log.js";
import { specResourcesPath } from "../utils/constants.js";
import { endTiming, startTiming } from "../utils/performance.js";
import { clearImplicitGeneratorState } from "./generatorCache.js";
import { contextOf, loadHistory, recordCommand, topCommands } from "./history.js";
import { setOrder } from "./order.js";
import { jumpCommands, jumpSuggestions } from "./jumps.js";
import { augmentSpec, enrichSuggestions } from "./project.js";
import { loadCustomSpecs } from "./customSpecs.js";
import { thintSpec } from "./thintSpec.js";
import { bundledSpecs } from "../specs/index.js";
import { riskOfEntry, riskOfLine, riskOfValue } from "./extras/risk.js";
import { refreshGitAliases } from "./extras/git.js";
import { describeRecent, recentCommands, rememberCommand } from "./extras/recent.js";
import { loadSnippets, previewSnippet } from "./extras/snippets.js";
import { findFixes, Failure } from "./extras/fixes.js";
import { run as runProgram } from "./extras/util.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- recursive type, setting as any
const specSet: any = {};
let specNames: string[] = [];
// thint's own spec and the user's YAML specs; kept when a spec set from ~/.fig replaces the list
let ownSpecNames: string[] = [];
const ignoredSpecs = ["gcloud", "az", "aws"];
const speclist = figSpecList.filter((spec: string) => !ignoredSpecs.some((name) => spec === name || spec.startsWith(name + "/")));
const versionedSpeclist = figVersionedSpeclist.filter((spec: string) => !ignoredSpecs.some((name) => spec.startsWith(name)));

function loadSpecsSet(speclist: string[], versionedSpeclist: string[], specsPath: string) {
  speclist.forEach((s) => {
    let activeSet = specSet;
    const specRoutes = s.split("/");
    specRoutes.forEach((route, idx) => {
      if (typeof activeSet !== "object") {
        return;
      }
      if (idx === specRoutes.length - 1) {
        const prefix = versionedSpeclist.includes(s) ? "/index.js" : `.js`;
        activeSet[route] = `${specsPath}${path.sep}${s}${prefix}`;
      } else {
        activeSet[route] = activeSet[route] || {};
        activeSet = activeSet[route];
      }
    });
  });
  // a folder of specs without its own (withfig ships `example/git_push` but no `example`) is not a command
  const commands = Object.keys(specSet).filter((spec) => !spec.startsWith("@") && spec != "-" && typeof specSet[spec] === "string");
  specNames = [...new Set([...commands, ...ownSpecNames])].sort();
}

loadSpecsSet(speclist as string[], versionedSpeclist, specResourcesPath);

const loadedSpecs: { [key: string]: Fig.Spec } = {};

const loadSpec = async (cmd: CommandToken[], signal?: AbortSignal): Promise<Fig.Spec | undefined> => {
  const rootToken = cmd.at(0);
  if (!rootToken?.complete) {
    return;
  }

  if (loadedSpecs[rootToken.token]) {
    return loadedSpecs[rootToken.token];
  }
  if (typeof specSet[rootToken.token] === "string") {
    signal?.throwIfAborted();
    const specPath = specSet[rootToken.token];
    const importPath = path.isAbsolute(specPath) ? pathToFileURL(specPath).href : specPath;
    const spec = augmentSpec(rootToken.token, (await import(importPath)).default);
    loadedSpecs[rootToken.token] = spec;
    return spec;
  }
};

// Loads the specs of the commands typed most, right after startup, so the first `git ` of a new tab does not wait
// for the spec file to be read and compiled. The commands you ran most often come first.
export const warmSpecs = async (): Promise<void> => {
  const common = ["git", "cd", "ls", "npm", "pnpm", "yarn", "npx", "docker", "brew"];
  const used = topCommands(10);
  for (const name of [...new Set([...used, ...common])]) {
    if (typeof specSet[name] !== "string" || loadedSpecs[name]) continue;
    try {
      await loadSpec([{ token: name, tokenLength: name.length, complete: true, isOption: false }]);
    } catch (e) {
      log.debug({ msg: "could not warm spec", name, e: (e as Error).message });
    }
  }
};

// this load spec function should only be used for `loadSpec` on the fly as it is cacheless
const lazyLoadSpec = async (key: string, signal?: AbortSignal): Promise<Fig.Spec | undefined> => {
  signal?.throwIfAborted();
  const specPath = path.join(specResourcesPath, `${key}.js`);
  const importPath = path.isAbsolute(specPath) ? pathToFileURL(specPath).href : specPath;
  // `docker compose` loads the docker-compose spec this way; it gets the project suggestions too
  return augmentSpec(key, (await import(importPath)).default);
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- will be implemented in below TODO
const lazyLoadSpecLocation = async (location: Fig.SpecLocation, signal?: AbortSignal): Promise<Fig.Spec | undefined> => {
  return; //TODO: implement spec location loading
};

// specs from ~/.config/terminalhinter/specs (YAML or JSON) win over the built-in ones with the same name
const loadUserSpecs = () => {
  const { specs: custom } = loadCustomSpecs();
  // terminalhinter's own commands first, so a user file with the same name still wins
  const specs = new Map<string, Fig.Spec>([
    ...bundledSpecs.map(([name, spec]) => [name, augmentSpec(name, spec)] as [string, Fig.Spec]),
    ["thint", thintSpec],
    ["terminalhinter", { ...thintSpec, name: "terminalhinter" }],
    ...custom,
  ]);
  for (const [name, spec] of specs) loadedSpecs[name] = spec;
  ownSpecNames = [...specs.keys()];
  specNames = [...new Set([...specNames, ...ownSpecNames])].sort();
};

export const loadLocalSpecsSet = async () => {
  loadUserSpecs();
  const specsPath = getConfig().specs.path;
  await Promise.allSettled(
    specsPath.map((specPath) => {
      const indexPath = path.join(specPath, "index.js");
      const importPath = path.isAbsolute(indexPath) ? pathToFileURL(indexPath).href : indexPath;
      return import(importPath)
        .then((res) => {
          const { default: speclist, diffVersionedCompletions: versionedSpeclist } = res;
          loadSpecsSet(speclist, versionedSpeclist, specPath);
        })
        .catch((e) => {
          log.debug({ msg: `no local specs imported from '${specPath}', this will not break the current session`, e: (e as Error).message, specPath });
        });
    }),
  );
};

// Saves the order you arranged with Shift+Up / Shift+Down for the spot being completed in `cmd` (see order.ts).
export const reorderSuggestions = (cmd: string, shell: Shell, names: string[]): void => {
  try {
    const tokens = aliasExpand(parseCommand(cmd, shell));
    const before = tokens.at(-1)?.complete === false ? tokens.slice(0, -1) : tokens;
    setOrder(contextOf(before), names);
  } catch (e) {
    log.debug({ msg: "could not save the order", e: (e as Error).message });
  }
};

// Remembers the arguments of a command that was just run, for frecency ranking (history.ts).
export const recordExecutedCommand = (cmd: string, cwd: string, shell: Shell): void => {
  try {
    const tokens = aliasExpand(parseCommand(cmd.trim() + " ", shell));
    if (tokens.length > 1) recordCommand(tokens, cwd);
  } catch (e) {
    log.debug({ msg: "could not record command", e: (e as Error).message });
  }
};

// A whole command for the history entries, once it is known that it did not fail.
export const rememberWholeCommand = (cmd: string, cwd: string): void => {
  if (getConfig().historyEntries) rememberCommand(cmd, cwd);
};

export { loadHistory };

export const getSuggestions = async (cmd: string, cwd: string, shell: Shell, signal?: AbortSignal): Promise<SuggestionBlob | undefined> => {
  const suggestionTiming = startTiming();
  try {
    let activeCmd = parseCommand(cmd, shell);
    const rootToken = activeCmd.at(0);
    if (activeCmd.length === 0) {
      return;
    }
    if (rootToken != null && !rootToken.complete) {
      return runCommand(rootToken, cwd);
    }

    activeCmd = aliasExpand(activeCmd);

    signal?.throwIfAborted();
    const spec = await loadSpec(activeCmd, signal);
    if (spec == null) return;
    const subcommand = getSubcommand(spec);
    if (subcommand == null) return;
    if (activeCmd[0]?.token === "git") refreshGitAliases(subcommand as Parameters<typeof refreshGitAliases>[0], cwd);

    signal?.throwIfAborted();
    const lastCommand = activeCmd.at(-1);
    const { cwd: resolvedCwd, pathy, complete: pathyComplete } = await resolveCwd(lastCommand, cwd, shell, signal);
    if (pathy && lastCommand) {
      lastCommand.isPath = true;
      lastCommand.isPathComplete = pathyComplete;
    }
    let result = await runSubcommand(activeCmd.slice(1), activeCmd, subcommand, resolvedCwd, shell, undefined, undefined, undefined, undefined, signal);
    // `cd` also offers bookmarks and frequent folders from anywhere, after the folders of the current directory
    const root = activeCmd.at(0)?.token ?? "";
    const typingFirstArg = activeCmd.length === 1 || (activeCmd.length === 2 && lastCommand?.complete === false);
    if (jumpCommands.has(root) && typingFirstArg) {
      const partial = lastCommand?.complete === false && activeCmd.length === 2 ? lastCommand.token : "";
      const jumps = jumpSuggestions(partial, cwd, result?.suggestions ?? []);
      if (jumps.length > 0) result = { ...result, suggestions: [...(result?.suggestions ?? []), ...jumps] };
    }
    if (result == null) return;
    if (result.suggestions.length == 0 && !result.argumentDescription) return;
    await enrichSuggestions(root, result.suggestions, cwd);
    markRisks(activeCmd, result.suggestions);
    // `react@` lists versions only, not the package names a search would find for the same text
    if (result.suggestions.some((s) => s.kind === "version")) result = { ...result, suggestions: result.suggestions.filter((s) => s.kind === "version") };

    const activeToken = lastCommand?.complete ? undefined : lastCommand;
    // a fully typed directory like `websites/` lets the UI offer "run it here" as the first entry, like Kiro/Fig did
    const isPathContext = activeToken?.isPath === true && activeToken.isPathComplete === true && activeToken.token.length > 0;
    return { ...result, activeToken, isPathContext, rootCommand: activeCmd.at(0)?.token };
  } finally {
    endTiming("runtime.getSuggestions", suggestionTiming);
  }
};

export const getSpecNames = (): string[] => {
  return specNames;
};

export const clearTransientSuggestionState = (): void => clearImplicitGeneratorState();

const prefixMatches = (values: string[], prefix: string): string[] => {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (values[middle] < prefix) low = middle + 1;
    else high = middle;
  }

  const matches: string[] = [];
  for (let index = low; index < values.length && values[index].startsWith(prefix); index++) {
    matches.push(values[index]);
  }
  return matches;
};

const getPersistentOptions = (persistentOptions: Fig.Option[], options?: Fig.Option[]) => {
  const persistentOptionNames = new Set(persistentOptions.map((o) => (typeof o.name === "string" ? [o.name] : o.name)).flat());
  return persistentOptions.concat(
    (options ?? []).filter(
      (o) => (typeof o.name == "string" ? !persistentOptionNames.has(o.name) : o.name.some((n) => !persistentOptionNames.has(n))) && o.isPersistent === true,
    ),
  );
};

// TODO: handle subcommands that are versioned
const getSubcommand = (spec?: Fig.Spec): Fig.Subcommand | undefined => {
  if (spec == null) return;
  if (typeof spec === "function") {
    const potentialSubcommand = spec();
    if (Object.prototype.hasOwnProperty.call(potentialSubcommand, "name")) {
      return potentialSubcommand as Fig.Subcommand;
    }
    return;
  }
  return spec;
};

const genSubcommand = async (command: string, parentCommand: Fig.Subcommand, signal?: AbortSignal): Promise<Fig.Subcommand | undefined> => {
  if (!parentCommand.subcommands || parentCommand.subcommands.length === 0) return;

  const subcommandIdx = parentCommand.subcommands.findIndex((s) => (Array.isArray(s.name) ? s.name.includes(command) : s.name === command));

  if (subcommandIdx === -1) return;
  const subcommand = parentCommand.subcommands[subcommandIdx];

  // this pulls in the spec from the load spec and overwrites the subcommand in the parent with the loaded spec.
  // then it returns the subcommand and clears the loadSpec field so that it doesn't get called again
  signal?.throwIfAborted();
  const executeShellCommand = buildExecuteShellCommand(5000, signal);
  switch (typeof subcommand.loadSpec) {
    case "function": {
      const partSpec = await subcommand.loadSpec(command, executeShellCommand);
      if (partSpec instanceof Array) {
        const locationSpecs = (await Promise.all(partSpec.map((s) => lazyLoadSpecLocation(s, signal)))).filter((s) => s != null) as Fig.Spec[];
        const subcommands = locationSpecs.map((s) => getSubcommand(s)).filter((s) => s != null) as Fig.Subcommand[];
        (parentCommand.subcommands as Fig.Subcommand[])[subcommandIdx] = {
          ...subcommand,
          ...(subcommands.find((s) => s?.name == command) ?? []),
          loadSpec: undefined,
          name: subcommand.name, // the loaded spec is named after its file (docker-compose), the entry stays `compose`
        };
        return (parentCommand.subcommands as Fig.Subcommand[])[subcommandIdx];
      } else if (Object.prototype.hasOwnProperty.call(partSpec, "type")) {
        const locationSingleSpec = await lazyLoadSpecLocation(partSpec as Fig.SpecLocation, signal);
        (parentCommand.subcommands as Fig.Subcommand[])[subcommandIdx] = {
          ...subcommand,
          ...(getSubcommand(locationSingleSpec) ?? []),
          loadSpec: undefined,
          name: subcommand.name, // the loaded spec is named after its file (docker-compose), the entry stays `compose`
        };
        return (parentCommand.subcommands as Fig.Subcommand[])[subcommandIdx];
      } else {
        (parentCommand.subcommands as Fig.Subcommand[])[subcommandIdx] = {
          ...subcommand,
          ...partSpec,
          loadSpec: undefined,
          name: subcommand.name, // the loaded spec is named after its file (docker-compose), the entry stays `compose`
        };
        return (parentCommand.subcommands as Fig.Subcommand[])[subcommandIdx];
      }
    }
    case "string": {
      const spec = await lazyLoadSpec(subcommand.loadSpec as string, signal);
      (parentCommand.subcommands as Fig.Subcommand[])[subcommandIdx] = {
        ...subcommand,
        ...(getSubcommand(spec) ?? []),
        loadSpec: undefined,
        name: subcommand.name, // the loaded spec is named after its file (docker-compose), the entry stays `compose`
      };
      return (parentCommand.subcommands as Fig.Subcommand[])[subcommandIdx];
    }
    case "object": {
      (parentCommand.subcommands as Fig.Subcommand[])[subcommandIdx] = {
        ...subcommand,
        ...(subcommand.loadSpec ?? {}),
        loadSpec: undefined,
        name: subcommand.name, // the loaded spec is named after its file (docker-compose), the entry stays `compose`
      };
      return (parentCommand.subcommands as Fig.Subcommand[])[subcommandIdx];
    }
    case "undefined": {
      return subcommand;
    }
  }
};

const getOption = (activeToken: CommandToken, options: Fig.Option[]): Fig.Option | undefined => {
  return options.find((o) => (typeof o.name === "string" ? o.name === activeToken.token : o.name.includes(activeToken.token)));
};

const getPersistentTokens = (tokens: CommandToken[]): CommandToken[] => {
  return tokens.filter((t) => t.isPersistent === true);
};

const getArgs = (args: Fig.SingleOrArray<Fig.Arg> | undefined): Fig.Arg[] => {
  return args instanceof Array ? args : args != null ? [args] : [];
};

const runOption = async (
  tokens: CommandToken[],
  allTokens: CommandToken[],
  option: Fig.Option,
  subcommand: Fig.Subcommand,
  cwd: string,
  shell: Shell,
  persistentOptions: Fig.Option[],
  acceptedTokens: CommandToken[],
  signal?: AbortSignal,
): Promise<SuggestionBlob | undefined> => {
  if (tokens.length === 0) {
    throw new Error("invalid state reached, option expected but no tokens found");
  }
  const activeToken = tokens[0];
  const isPersistent = persistentOptions.some((o) => (typeof o.name === "string" ? o.name === activeToken.token : o.name.includes(activeToken.token)));
  if ((option.args instanceof Array && option.args.length > 0) || option.args != null) {
    const args = option.args instanceof Array ? option.args : [option.args];
    return runArg(tokens.slice(1), allTokens, args, subcommand, cwd, shell, persistentOptions, acceptedTokens.concat(activeToken), true, false, signal);
  }
  return runSubcommand(
    tokens.slice(1),
    allTokens,
    subcommand,
    cwd,
    shell,
    persistentOptions,
    acceptedTokens.concat({
      ...activeToken,
      isPersistent,
    }),
    undefined,
    undefined,
    signal,
  );
};

const runArg = async (
  tokens: CommandToken[],
  allTokens: CommandToken[],
  args: Fig.Arg[],
  subcommand: Fig.Subcommand,
  cwd: string,
  shell: Shell,
  persistentOptions: Fig.Option[],
  acceptedTokens: CommandToken[],
  fromOption: boolean,
  fromVariadic: boolean,
  signal?: AbortSignal,
): Promise<SuggestionBlob | undefined> => {
  signal?.throwIfAborted();
  if (args.length === 0) {
    return runSubcommand(tokens, allTokens, subcommand, cwd, shell, persistentOptions, acceptedTokens, true, !fromOption, signal);
  } else if (tokens.length === 0) {
    return await getArgDrivenRecommendation(args, subcommand, persistentOptions, undefined, acceptedTokens, allTokens, fromVariadic, cwd, shell, signal);
  } else if (!tokens.at(0)?.complete) {
    return await getArgDrivenRecommendation(args, subcommand, persistentOptions, tokens[0], acceptedTokens, allTokens, fromVariadic, cwd, shell, signal);
  }

  const activeToken = tokens[0];
  // a known option in the middle of a variadic argument (`turbo run build --filter web`) is still an option
  if (activeToken.isOption && args.at(0)?.isVariadic && !args.every((a) => a.isOptional)) {
    const option = getOption(activeToken, persistentOptions.concat(subcommand.options ?? []));
    if (option != null) {
      return runOption(tokens, allTokens, option, subcommand, cwd, shell, persistentOptions, acceptedTokens, signal);
    }
  }
  if (args.every((a) => a.isOptional)) {
    if (activeToken.isOption) {
      const option = getOption(activeToken, persistentOptions.concat(subcommand.options ?? []));
      if (option != null) {
        return runOption(tokens, allTokens, option, subcommand, cwd, shell, persistentOptions, acceptedTokens, signal);
      }
      return;
    }

    const nextSubcommand = await genSubcommand(activeToken.token, subcommand, signal);
    if (nextSubcommand != null) {
      return runSubcommand(
        tokens.slice(1),
        allTokens,
        nextSubcommand,
        cwd,
        shell,
        persistentOptions,
        getPersistentTokens(acceptedTokens.concat(activeToken)),
        undefined,
        undefined,
        signal,
      );
    }
  }

  const activeArg = args[0];
  if (activeArg.isVariadic) {
    return runArg(tokens.slice(1), allTokens, args, subcommand, cwd, shell, persistentOptions, acceptedTokens.concat(activeToken), fromOption, true, signal);
  } else if (activeArg.isCommand) {
    if (tokens.length <= 0) {
      return;
    }
    const spec = await loadSpec(tokens, signal);
    if (spec == null) return;
    const subcommand = getSubcommand(spec);
    if (subcommand == null) return;
    return runSubcommand(tokens.slice(1), allTokens, subcommand, cwd, shell, undefined, undefined, undefined, undefined, signal);
  }
  return runArg(
    tokens.slice(1),
    allTokens,
    args.slice(1),
    subcommand,
    cwd,
    shell,
    persistentOptions,
    acceptedTokens.concat(activeToken),
    fromOption,
    false,
    signal,
  );
};

const runSubcommand = async (
  tokens: CommandToken[],
  allTokens: CommandToken[],
  subcommand: Fig.Subcommand,
  cwd: string,
  shell: Shell,
  persistentOptions: Fig.Option[] = [],
  acceptedTokens: CommandToken[] = [],
  argsDepleted = false,
  argsUsed = false,
  signal?: AbortSignal,
): Promise<SuggestionBlob | undefined> => {
  signal?.throwIfAborted();
  if (tokens.length === 0) {
    return getSubcommandDrivenRecommendation(subcommand, persistentOptions, undefined, argsDepleted, argsUsed, acceptedTokens, allTokens, cwd, shell, signal);
  } else if (!tokens.at(0)?.complete) {
    return getSubcommandDrivenRecommendation(subcommand, persistentOptions, tokens[0], argsDepleted, argsUsed, acceptedTokens, allTokens, cwd, shell, signal);
  }

  const activeToken = tokens[0];
  const activeArgsLength = subcommand.args instanceof Array ? subcommand.args.length : 1;
  const allOptions = [...persistentOptions, ...(subcommand.options ?? [])];

  if (activeToken.isOption) {
    const option = getOption(activeToken, allOptions);
    if (option != null) {
      return runOption(tokens, allTokens, option, subcommand, cwd, shell, persistentOptions, acceptedTokens, signal);
    }
    return;
  }

  const nextSubcommand = await genSubcommand(activeToken.token, subcommand, signal);
  if (nextSubcommand != null) {
    return runSubcommand(
      tokens.slice(1),
      allTokens,
      nextSubcommand,
      cwd,
      shell,
      getPersistentOptions(persistentOptions, subcommand.options),
      getPersistentTokens(acceptedTokens.concat(activeToken)),
      undefined,
      undefined,
      signal,
    );
  }

  if (activeArgsLength <= 0) {
    return; // not subcommand or option & no args exist
  }

  const args = getArgs(subcommand.args);
  if (args.length != 0) {
    return runArg(tokens, allTokens, args, subcommand, cwd, shell, allOptions, acceptedTokens, false, false, signal);
  }
  // if the subcommand has no args specified, fallback to the subcommand and ignore this item
  return runSubcommand(tokens.slice(1), allTokens, subcommand, cwd, shell, persistentOptions, acceptedTokens.concat(activeToken), undefined, undefined, signal);
};

// the words before the one being completed decide which options and subcommands are risky (`git push` + --force)
const markRisks = (tokens: CommandToken[], suggestions: Suggestion[]) => {
  const before = (tokens.at(-1)?.complete === false ? tokens.slice(0, -1) : tokens).filter((t) => !t.isOption && !t.token.startsWith("-")).map((t) => t.token);
  for (const s of suggestions) {
    if (s.risk != null || s.type === "file" || s.type === "folder") continue;
    const entry =
      s.type === "option" || s.type === "subcommand" || s.icon === SuggestionIcons.Option || s.icon === SuggestionIcons.Subcommand || s.name.startsWith("-");
    const risk = entry ? riskOfEntry(before, s.name) : riskOfValue(s.name);
    if (risk) s.risk = risk;
  }
};

const runCommand = async (token: CommandToken, cwd: string): Promise<SuggestionBlob | undefined> => {
  const specs = prefixMatches(specNames, token.token);
  const aliases = prefixMatches(getAliasNames(), token.token);
  // whole commands you ran in this folder that start with what you typed, right after the best command name
  const recent = getConfig().historyEntries
    ? (await recentCommands(cwd, token.token, 3).catch(() => [])).map(
        (r) =>
          ({
            name: r.command,
            allNames: [r.command],
            insertValue: r.command,
            description: describeRecent(r),
            icon: "🕘",
            priority: 90,
            kind: "recent",
          }) as Suggestion,
      )
    : [];
  const snippets = loadSnippets()
    .snippets.filter((s) => s.name.toLowerCase().startsWith(token.token.toLowerCase()))
    .map(
      (s) =>
        ({
          name: s.name,
          allNames: [s.name],
          description: s.description ? `${s.description} · ${previewSnippet(s.command)}` : previewSnippet(s.command),
          icon: "✂",
          priority: 80,
          snippet: s.command,
          kind: "snippet",
        }) as Suggestion,
    );
  const names = [
    ...aliases.map(
      (alias) =>
        ({
          name: alias,
          description: getAliasCommand(alias),
          type: "shortcut",
          allNames: [alias],
          icon: SuggestionIcons.Shortcut,
          priority: 100,
        }) as Suggestion,
    ),
    ...specs.map(
      (spec) =>
        ({
          name: spec,
          type: "subcommand",
          allNames: [spec],
          icon: SuggestionIcons.Subcommand,
          priority: 40,
        }) as Suggestion,
    ),
  ];
  return {
    // history right after the command it starts with (`git` then your git lines), or first when no name matches it
    suggestions: (() => {
      const first = recent[0]?.name.split(/\s+/)[0];
      const at = names.findIndex((n) => n.name === first);
      return at === -1 ? [...recent, ...snippets, ...names] : [...names.slice(0, at + 1), ...recent, ...snippets, ...names.slice(at + 1)];
    })(),
    activeToken: token,
  };
};

// Fixes for a command that just failed, as list entries that put the fixed command on the line.
export const getFixes = async (failure: Failure): Promise<SuggestionBlob | undefined> => {
  const commands = () => new Set([...specNames, ...getAliasNames()]);
  const branches = async () =>
    (await runProgram("git", ["for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes"], failure.cwd))
      .split("\n")
      .filter(Boolean)
      .map((b) => b.replace(/^origin\//, ""));
  const fixes = await findFixes(failure, commands, branches);
  if (fixes.length === 0) return;
  return {
    mode: "fix",
    suggestions: fixes.map((f) => ({
      name: f.command,
      allNames: [f.command],
      insertValue: f.command,
      description: f.reason,
      icon: "⭐",
      priority: 100,
      kind: "fix",
    })),
  };
};

// What each word of the line means, from the command specs: the command, its subcommands, options and arguments.
const operators: Record<string, string> = {
  "|": "sends the output into the next command",
  "|&": "sends the output and the errors into the next command",
  "&&": "runs the next command if this one worked",
  "||": "runs the next command if this one failed",
  ";": "then runs the next command",
  "&": "runs it in the background",
  ">": "writes the output to the file, replacing what is there",
  ">>": "adds the output to the end of the file",
  "<": "reads the input from the file",
  "2>": "writes the errors to the file",
  "2>&1": "sends the errors where the output goes",
  "&>": "writes output and errors to the file",
};

// words that run the command after them: their own note, then the command is explained as usual
const wrappers: Record<string, string> = {
  sudo: "runs the rest as the administrator",
  doas: "runs the rest as the administrator",
  env: "runs the rest with these environment variables",
  time: "runs the rest and prints how long it took",
  nohup: "keeps the rest running after you close the terminal",
  nice: "runs the rest with a lower priority",
  command: "runs the rest, skipping aliases and functions",
  exec: "replaces the shell with the rest",
  watch: "runs the rest again every few seconds",
};

// splits a line at |, &&, ||, ; and redirects, outside quotes
const splitLine = (line: string): string[] => {
  const parts: string[] = [];
  let current = "";
  let quote: string | undefined;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      current += c;
      if (c === quote && line[i - 1] !== "\\") quote = undefined;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      current += c;
      continue;
    }
    const op = ["2>&1", "&&", "||", "|&", ">>", "&>", "2>", "|", ";", ">", "<", "&"].find((o) => line.startsWith(o, i) && line[i - 1] !== "\\");
    if (op && !(op === "&" && line[i + 1] === ">")) {
      if (current.trim()) parts.push(current.trim());
      parts.push(op);
      current = "";
      i += op.length - 1;
      continue;
    }
    current += c;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
};

export const explainCommand = async (cmd: string, shell: Shell): Promise<SuggestionBlob | undefined> => {
  const entries: Suggestion[] = [];
  const notes: string[] = [];
  const parts = splitLine(cmd.trim());
  let afterRedirect = false;
  for (const part of parts) {
    if (operators[part] != null) {
      entries.push({ name: part, allNames: [part], description: operators[part], icon: "📀", priority: 0, kind: "explain" });
      afterRedirect = [">", ">>", "<", "2>", "&>"].includes(part);
      continue;
    }
    if (afterRedirect) {
      // the file after a redirect, and whatever follows it on the same side
      const [file, ...rest] = part.split(/\s+/);
      entries.push({ name: file, allNames: [file], description: "the file", icon: "📀", priority: 0, kind: "explain" });
      afterRedirect = false;
      if (rest.length > 0) await explainSegment(rest.join(" "), shell, entries, notes);
      continue;
    }
    await explainSegment(part, shell, entries, notes);
  }
  if (entries.length === 0) return;
  return { mode: "explain", suggestions: entries, notes: [...new Set(notes)] };
};

const explainSegment = async (segment: string, shell: Shell, entries: Suggestion[], notes: string[]): Promise<void> => {
  let tokens = parseCommand(segment + " ", shell).filter((t) => t.complete);
  const add = (name: string, description: string | undefined, risk?: string) =>
    entries.push({ name, allNames: [name], description: description ?? "", icon: "📀", priority: 0, risk, kind: "explain" });
  // sudo, env FOO=1, time and friends: say what they do, then explain the command they run
  while (tokens.length > 1 && (wrappers[tokens[0].token] != null || /^[A-Za-z_]\w*=/.test(tokens[0].token))) {
    const word = tokens[0].token;
    add(word, wrappers[word] ?? "sets this environment variable for the command");
    tokens = tokens.slice(1);
    while (tokens.length > 1 && tokens[0].token.startsWith("-") && wrappers[word] != null) {
      add(tokens[0].token, `option of ${word}`);
      tokens = tokens.slice(1);
    }
    if (word === "sudo" || word === "doas") notes.push("runs as the administrator: mistakes can touch the whole system");
  }
  if (tokens.length === 0) return;
  notes.push(...riskOfLine(tokens.map((t) => t.token)));
  const rootName = tokens[0].token;
  const alias = getAliasCommand(rootName);
  if (alias && getAliasNames().includes(rootName)) add(rootName, `alias: ${alias}`);
  const expanded = aliasExpand(tokens);
  const spec = await loadSpec(expanded);
  let node = getSubcommand(spec);
  if (!(alias && getAliasNames().includes(rootName))) add(rootName, node?.description ?? (node == null ? "no description for this command" : ""));
  const path: string[] = [expanded[0].token];
  let persistent: Fig.Option[] = (node?.options ?? []).filter((o) => o.isPersistent);
  let args = getArgs(node?.args);
  const rest = expanded.slice(1);
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i].token;
    if (node == null) {
      add(word, "");
      continue;
    }
    if (word.startsWith("-") && word !== "-") {
      const [flag, inline] =
        word.startsWith("--") && word.includes("=") ? [word.slice(0, word.indexOf("=")), word.slice(word.indexOf("=") + 1)] : [word, undefined];
      const options = [...persistent, ...(node.options ?? [])];
      const option = options.find((o) => (Array.isArray(o.name) ? o.name : [o.name]).includes(flag));
      // -rf: every letter is an option of its own
      if (option == null && /^-[a-zA-Z]{2,}$/.test(word)) {
        const letters = [...word.slice(1)].map((l) => options.find((o) => (Array.isArray(o.name) ? o.name : [o.name]).includes(`-${l}`)));
        if (letters.every((o) => o != null)) {
          add(word, letters.map((o, j) => `-${word[j + 1]}: ${o?.description ?? ""}`).join("; "), riskOfEntry(path, word));
          continue;
        }
      }
      add(word, option?.description ?? "unknown option", riskOfEntry(path, flag) ?? riskOfEntry(path, word));
      const optionArgs = getArgs(option?.args).filter((a) => !a.isOptional);
      if (optionArgs.length > 0 && inline == null && i + 1 < rest.length) {
        i++;
        add(rest[i].token, `value of ${flag}: ${optionArgs[0].description ?? optionArgs[0].name ?? "value"}`, riskOfValue(rest[i].token));
      }
      continue;
    }
    const sub = await genSubcommand(word, node);
    if (sub != null) {
      add(word, sub.description, riskOfEntry(path, word));
      path.push(word);
      node = sub;
      persistent = [...persistent, ...(sub.options ?? []).filter((o) => o.isPersistent)];
      args = getArgs(sub.args);
      continue;
    }
    const arg = args.at(0);
    add(word, arg ? `${arg.name ?? "argument"}${arg.description ? `: ${arg.description}` : ""}` : "argument", riskOfValue(word));
    if (arg != null && !arg.isVariadic) args = args.slice(1);
  }
};
