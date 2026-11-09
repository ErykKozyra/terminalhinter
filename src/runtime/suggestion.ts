// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";

import { CommandToken } from "./parser.js";
import { getGeneratorSuggestions } from "./generatorCache.js";
import { getGeneratorQueryTerm } from "./generator.js";
import { runTemplates } from "./template.js";
import { Suggestion, SuggestionBlob } from "./model.js";
import log from "../utils/log.js";
import { escapePath } from "./utils.js";
import { addPathSeparator, endsWithPathSeparator, getPathDirname, removePathSeparator, Shell } from "../utils/shell.js";
import { getConfig } from "../utils/config.js";
import { contextOf, frecency } from "./history.js";
import { orderRank } from "./order.js";

export enum SuggestionIcons {
  File = "📄",
  Folder = "📁",
  Subcommand = "📦",
  Option = "🔗",
  Argument = "💲",
  Mixin = "🏝️",
  Shortcut = "🔥",
  Special = "⭐",
  Default = "📀",
}

const getIcon = (icon: string | undefined, suggestionType: Fig.SuggestionType | undefined): string => {
  // eslint-disable-next-line no-control-regex
  if (icon && /[^\u0000-\u00ff]/.test(icon)) {
    return icon;
  }
  switch (suggestionType) {
    case "arg":
      return SuggestionIcons.Argument;
    case "file":
      return SuggestionIcons.File;
    case "folder":
      return SuggestionIcons.Folder;
    case "option":
      return SuggestionIcons.Option;
    case "subcommand":
      return SuggestionIcons.Subcommand;
    case "mixin":
      return SuggestionIcons.Mixin;
    case "shortcut":
      return SuggestionIcons.Shortcut;
    case "special":
      return SuggestionIcons.Special;
  }
  return SuggestionIcons.Default;
};

// Renders the args of a subcommand or option the way Fig/Kiro show them: <required> [optional] <variadic...>
export const formatArgs = (suggestion: unknown): string | undefined => {
  const raw = (suggestion as { args?: Fig.SingleOrArray<Fig.Arg> } | undefined)?.args;
  if (raw == null) return undefined;
  const args = raw instanceof Array ? raw : [raw];
  const parts = args
    .filter((a) => a != null)
    .map((a) => {
      const name = (a.name ?? "arg") + (a.isVariadic ? "..." : "");
      return a.isOptional ? `[${name}]` : `<${name}>`;
    });
  return parts.length === 0 ? undefined : parts.join(" ");
};

const getLong = (suggestion: Fig.SingleOrArray<string>): string => {
  return suggestion instanceof Array ? suggestion.reduce((p, c) => (p.length > c.length ? p : c)) : suggestion;
};

const getPathy = (type: Fig.SuggestionType | undefined): boolean => {
  return type === "file" || type === "folder";
};

const toSuggestion = (suggestion: Fig.Suggestion, name?: string, type?: Fig.SuggestionType): Suggestion | undefined => {
  if (suggestion.name == null) return;
  return {
    name: name ?? getLong(suggestion.name),
    description: suggestion.description,
    icon: getIcon(suggestion.icon, type ?? suggestion.type),
    allNames: suggestion.name instanceof Array ? suggestion.name : [suggestion.name],
    priority: getSuggestionPriority(suggestion),
    insertValue: suggestion.insertValue,
    type: suggestion.type,
    hidden: suggestion.hidden,
    args: formatArgs(suggestion),
    ...((suggestion as { risk?: string }).risk ? { risk: (suggestion as { risk?: string }).risk } : {}),
    ...((suggestion as { kind?: Suggestion["kind"] }).kind ? { kind: (suggestion as { kind?: Suggestion["kind"] }).kind } : {}),
  };
};

const getSuggestionPriority = (suggestion: Fig.Suggestion): number => {
  const isOption =
    suggestion.type === "option" ||
    (suggestion.name instanceof Array
      ? suggestion.name.some((n) => n.startsWith("--") || n.startsWith("-"))
      : suggestion?.name?.startsWith("--") || suggestion?.name?.startsWith("-"));
  if (isOption) return 45;
  return suggestion.priority ?? 50;
};

// How well a name matches the text typed so far: 3 = exact, 2 = prefix, 1 = substring, 0 = fuzzy only.
const getMatchRelevance = (name: string, partialCmd: string): number => {
  const haystack = name.toLowerCase();
  const needle = partialCmd.toLowerCase();
  if (haystack === needle) return 3;
  const matchIndex = haystack.indexOf(needle);
  if (matchIndex === 0) return 2;
  if (matchIndex > 0) return 1;
  return 0;
};

// An exact match of what was typed always comes first (`pnpm dev` puts the `dev` script above `dev:vite`).
// Then names that start with the typed text, then names that only contain it. Inside each group: the order you set
// yourself, then what you use often, then the priority the spec gives. Paths are also ranked by shorter names and alphabetically; everything else keeps its
// source order among equally good matches (the sort is stable), except values, where shorter names go first.
const sortSuggestions = (
  suggestions: Suggestion[],
  partialCmd: string | undefined,
  score: (s: Suggestion) => number = () => 0,
  rank: (s: Suggestion) => number | undefined = () => undefined,
): Suggestion[] => {
  // how often and how recently you used each value here (see history.ts); computed once per suggestion
  const scores = new Map(suggestions.map((s) => [s, score(s)]));
  const used = (s: Suggestion) => scores.get(s) ?? 0;
  // the order you set with Shift+Up / Shift+Down (see order.ts): placed entries first, in your order
  const ranks = new Map(suggestions.map((s) => [s, rank(s) ?? Number.MAX_SAFE_INTEGER]));
  const placed = (a: Suggestion, b: Suggestion) => (ranks.get(a) ?? 0) - (ranks.get(b) ?? 0);
  // what you use wins over the order the spec suggests
  const sorted = suggestions.sort((a, b) => placed(a, b) || used(b) - used(a) || b.priority - a.priority);
  // paths: folders before files, hidden entries (.git, .env) after the visible ones unless a dot was typed,
  // and `..` last
  const typedDot = partialCmd?.startsWith(".") ?? false;
  const pathGroup = (s: Suggestion) => (s.name === ".." ? 3 : !typedDot && s.name.startsWith(".") ? 2 : 0) + (s.type === "folder" ? 0 : 1);
  if (!partialCmd) {
    const pathIndexes = sorted.flatMap((s, i) => (getPathy(s.type) ? [i] : []));
    const ranked = pathIndexes
      .map((i) => sorted[i])
      .sort((a, b) => b.priority - a.priority || used(b) - used(a) || pathGroup(a) - pathGroup(b) || a.name.localeCompare(b.name));
    pathIndexes.forEach((sortedIndex, rank) => (sorted[sortedIndex] = ranked[rank]));
    return sorted;
  }
  const relevance = (s: Suggestion) => getMatchRelevance(s.name, partialCmd);
  // a short alias counts too: `pnpm i` is exactly `install`
  const typedLower = partialCmd.toLowerCase();
  const isExact = (s: Suggestion) => relevance(s) === 3 || s.allNames.some((n) => n.toLowerCase() === typedLower);
  // values (scripts, branches, generator results) prefer the shorter name; subcommands and options keep the
  // spec's own order, which puts the popular ones first
  // (specs leave `type` empty on most subcommands, so they are recognized by the icon they were given)
  const isValue = (s: Suggestion) =>
    s.type !== "subcommand" && s.type !== "option" && s.icon !== SuggestionIcons.Subcommand && s.icon !== SuggestionIcons.Option && !s.name.startsWith("-");
  // `-D` typed exactly beats `-d`
  const isExactCase = (s: Suggestion) => s.name === partialCmd || s.allNames.includes(partialCmd);
  sorted.sort(
    (a, b) =>
      Number(isExact(b)) - Number(isExact(a)) ||
      Number(isExactCase(b)) - Number(isExactCase(a)) ||
      // names that start with the typed text always beat names that only contain it, whatever their priority:
      // `p i` lists install before the `lint` script
      Math.min(relevance(b), 2) - Math.min(relevance(a), 2) ||
      placed(a, b) ||
      used(b) - used(a) ||
      b.priority - a.priority ||
      (isValue(a) && isValue(b) ? a.name.length - b.name.length : 0),
  );
  const pathIndexes = sorted.flatMap((s, i) => (getPathy(s.type) ? [i] : []));
  const rankedPaths = pathIndexes
    .map((i) => sorted[i])
    .sort(
      (a, b) =>
        Number(isExact(b)) - Number(isExact(a)) ||
        relevance(b) - relevance(a) ||
        b.priority - a.priority ||
        used(b) - used(a) ||
        pathGroup(a) - pathGroup(b) ||
        a.name.length - b.name.length ||
        a.name.localeCompare(b.name),
    );
  pathIndexes.forEach((sortedIndex, rank) => (sorted[sortedIndex] = rankedPaths[rank]));
  return sorted;
};

// True when every character of `needle` appears in `haystack` in order: "acst" matches "acme-store.com".
export const isSubsequence = (haystack: string, needle: string): boolean => {
  let at = 0;
  for (const char of haystack) {
    if (char === needle[at]) at++;
    if (at === needle.length) return true;
  }
  return needle.length === 0;
};

// Prefix matches by default ("fuzzy" specs also allow substrings). With fuzzyMatching on, names that start with the
// same letter and contain the rest of the typed characters in order are kept too; ranking puts them last.
const matchesName = (name: string, query: string, filterStrategy: FilterStrategy | undefined): boolean => {
  const lower = name.toLowerCase();
  if (lower.startsWith(query)) return true;
  if (filterStrategy === "fuzzy" && lower.includes(query)) return true;
  // a word inside the name counts as a start: "login" finds feature/login, "cart" finds fix/cart-total
  if (
    query.length >= 2 &&
    /^[a-z0-9]/.test(query) &&
    lower
      .split(/[/_.-]/)
      .slice(1)
      .some((part) => part.startsWith(query))
  )
    return true;
  if (!getConfig().fuzzyMatching) return false;
  // leading dashes and the $ of variables are ignored, otherwise "--b" would match every option containing a "b"
  // and "$HO" every variable with an H and an O; the first letter must match and at least three letters are needed,
  // which keeps the list short and is how people abbreviate ("acst" for acme-store.com)
  const word = lower.replace(/^[-$]+/, "");
  const typed = query.replace(/^[-$]+/, "");
  return typed.length >= 3 && word.startsWith(typed[0]) && isSubsequence(word, typed);
};

// Scores each suggestion by your history in this spot: the context is the words before the one being typed, paths
// are compared as absolute paths (see history.ts).
const historyScore =
  (allTokens: CommandToken[], cwd: string) =>
  (s: Suggestion): number => {
    const before = allTokens.at(-1)?.complete === false ? allTokens.slice(0, -1) : allTokens;
    const context = contextOf(before);
    if (getPathy(s.type)) return frecency(context, path.join(cwd, removePathSeparator(s.insertValue ?? s.name)));
    // `pnpm i` counts for install too
    const names = new Set([(s.insertValue ?? s.name).trim(), ...s.allNames]);
    return Math.max(...[...names].map((n) => frecency(context, n)));
  };

const orderRankOf =
  (allTokens: CommandToken[]) =>
  (s: Suggestion): number | undefined => {
    if (getPathy(s.type)) return undefined;
    const before = allTokens.at(-1)?.complete === false ? allTokens.slice(0, -1) : allTokens;
    return orderRank(contextOf(before), s.name);
  };

function filter<T extends Fig.BaseSuggestion & { name?: Fig.SingleOrArray<string>; type?: Fig.SuggestionType | undefined }>(
  suggestions: T[],
  filterStrategy: FilterStrategy | undefined,
  partialCmd: string | undefined,
  suggestionType: Fig.SuggestionType | undefined,
): Suggestion[] {
  if (!partialCmd) return suggestions.map((s) => toSuggestion(s, undefined, suggestionType)).filter((s) => s != null) as Suggestion[];
  const query = partialCmd.toLowerCase();
  return suggestions
    .map((s) => {
      if (s.name == null) return;
      const names = s.name instanceof Array ? s.name : [s.name];
      // prefer the alias that matches best: prefix, then substring, then in-order characters
      const matchedName =
        names.find((n) => n.toLowerCase().startsWith(query)) ??
        names.find((n) => matchesName(n, query, filterStrategy) && n.toLowerCase().includes(query)) ??
        names.find((n) => matchesName(n, query, filterStrategy));
      if (matchedName == null) return;
      return {
        name: matchedName,
        description: s.description,
        icon: getIcon(s.icon, s.type ?? suggestionType),
        allNames: names,
        insertValue: s.insertValue,
        priority: s.priority ?? 50,
        type: s.type,
        hidden: s.hidden,
        args: formatArgs(s),
        ...((s as { risk?: string }).risk ? { risk: (s as { risk?: string }).risk } : {}),
        ...((s as { kind?: Suggestion["kind"] }).kind ? { kind: (s as { kind?: Suggestion["kind"] }).kind } : {}),
      };
    })
    .filter((s) => s != null) as Suggestion[];
}

type FilterStrategy = "fuzzy" | "prefix" | "default";

const generatorSuggestions = async (
  generator: Fig.SingleOrArray<Fig.Generator> | undefined,
  allTokens: CommandToken[],
  filterStrategy: FilterStrategy | undefined,
  partialCmd: string | undefined,
  cwd: string,
  debounce: boolean,
  shell: Shell,
  signal?: AbortSignal,
): Promise<Suggestion[]> => {
  const generators = generator instanceof Array ? generator : generator ? [generator] : [];
  const tokens = allTokens.map((t) => t.token);
  const activeToken = allTokens.at(-1)?.complete === false ? allTokens.at(-1)?.token ?? "" : "";
  signal?.throwIfAborted();
  return (
    await Promise.all(
      generators.map(async (generator) =>
        filter<Fig.Suggestion>(
          (await getGeneratorSuggestions(generator, tokens, activeToken, cwd, debounce, signal)).map((suggestion) => ({
            ...suggestion,
            priority: suggestion.priority ?? 60,
            // a value with a space (a process name for killall) goes in quoted, or it would become several words
            ...(suggestion.insertValue == null && typeof suggestion.name === "string" && /\s/.test(suggestion.name) && !getPathy(suggestion.type)
              ? { insertValue: escapePath(suggestion.name, shell) }
              : {}),
          })),
          filterStrategy,
          generator.getQueryTerm == null ? partialCmd : getGeneratorQueryTerm(generator, activeToken),
          undefined,
        ),
      ),
    )
  ).flat();
};

const templateSuggestions = async (
  templates: Fig.Template | undefined,
  filterStrategy: FilterStrategy | undefined,
  partialCmd: string | undefined,
  cwd: string,
  signal?: AbortSignal,
): Promise<Suggestion[]> => {
  return filter<Fig.Suggestion>(await runTemplates(templates ?? [], cwd, signal), filterStrategy, partialCmd, undefined);
};

const suggestionSuggestions = (
  suggestions: (string | Fig.Suggestion)[] | undefined,
  filterStrategy: FilterStrategy | undefined,
  partialCmd: string | undefined,
): Suggestion[] => {
  const cleanedSuggestions = suggestions?.map((s) => (typeof s === "string" ? { name: s } : s)) ?? [];
  return filter<Fig.Suggestion>(cleanedSuggestions ?? [], filterStrategy, partialCmd, undefined);
};

const subcommandSuggestions = (
  subcommands: Fig.Subcommand[] | undefined,
  filterStrategy: FilterStrategy | undefined,
  partialCmd: string | undefined,
): Suggestion[] => {
  return filter<Fig.Subcommand>(subcommands ?? [], filterStrategy, partialCmd, "subcommand");
};

const optionSuggestions = (
  options: Fig.Option[] | undefined,
  acceptedTokens: CommandToken[],
  filterStrategy: FilterStrategy | undefined,
  partialCmd: string | undefined,
): Suggestion[] => {
  const usedOptions = new Set(acceptedTokens.filter((t) => t.isOption).map((t) => t.token));
  const validOptions = options?.filter((o) => o.exclusiveOn?.every((exclusiveOption) => !usedOptions.has(exclusiveOption)) ?? true);
  return filter<Fig.Option>(validOptions ?? [], filterStrategy, partialCmd, "option");
};

function adjustPathSuggestions(
  suggestions: Suggestion[],
  partialToken: CommandToken | undefined,
  lastToken: CommandToken | undefined,
  shell: Shell,
): Suggestion[] {
  const isInPath = lastToken?.isPath && !lastToken.complete;
  const isSpecialPathCharacter = (s: Suggestion) => s.name === "~";
  return suggestions.map((s) => {
    const specialPathy = isInPath && isSpecialPathCharacter(s);
    const pathy = getPathy(s.type) || specialPathy;
    const rawInsertValue = removePathSeparator(s.insertValue ?? s.name ?? "");
    const insertValue = s.type == "folder" || specialPathy ? addPathSeparator(rawInsertValue, shell) : rawInsertValue;
    const partialDir = getPathDirname(partialToken?.token ?? "", shell);
    const isPartialTokenPath = partialToken?.isPath && endsWithPathSeparator(partialDir, shell);
    const fullPath = isPartialTokenPath ? `${partialDir}${insertValue}` : insertValue;
    return pathy ? { ...s, insertValue: escapePath(fullPath, shell), name: removePathSeparator(s.name) } : s;
  });
}

// `git src/` or `ls src/in`: the word being typed is a path, so it is matched against the files and folders in
// there. Subcommands, options and other values stay only when they really start with what was typed; otherwise
// `git src/` listed every git subcommand.
const keepPathMatches = (suggestions: Suggestion[], partialToken: CommandToken | undefined, shell: Shell): Suggestion[] => {
  const token = partialToken?.token ?? "";
  if (!partialToken?.isPath || !endsWithPathSeparator(getPathDirname(token, shell), shell)) return suggestions;
  const typed = token.toLowerCase();
  return suggestions.filter((s) => getPathy(s.type) || s.allNames.some((n) => n.toLowerCase().startsWith(typed)));
};

const removeAcceptedSuggestions = (suggestions: Suggestion[], acceptedTokens: CommandToken[]): Suggestion[] => {
  const seen = new Set<string>(acceptedTokens.map((t) => t.token));
  return suggestions.filter((s) => s.allNames.every((n) => !seen.has(n)));
};

// The first entry of a name keeps its place. thint's own entry wins over a spec's with the same name, wherever it
// was: withfig's npm spec also lists `react@19.1.1`, and keeping that one dropped it from the version list.
const removeDuplicateSuggestion = (suggestions: Suggestion[]): Suggestion[] => {
  const kept = new Map<string, Suggestion>();
  for (const s of suggestions) {
    // a snippet called like a command (`deploy`, `kill`) stays next to the command instead of hiding it or being hidden
    const key = s.kind === "snippet" ? `\u0000snippet:${s.name}` : s.name;
    const first = kept.get(key);
    if (first == null) kept.set(key, s);
    else if (first.kind == null && s.kind != null) kept.set(key, s);
  }
  return [...kept.values()];
};

const removeHiddenSuggestions = (suggestions: Suggestion[], partialToken: CommandToken | undefined): Suggestion[] => {
  return suggestions.filter((s) => s.hidden !== true || (partialToken != null && s.name === partialToken.token));
};

const removeHomeDirectorySuggestion = (suggestions: Suggestion[], allTokens: CommandToken[]): Suggestion[] => {
  const containsHomeDir = allTokens.some((t) => t.token.startsWith("~"));
  return suggestions.filter((s) => s.type !== "folder" || !containsHomeDir || !s.name.startsWith("~"));
};

const removeEmptySuggestion = (suggestions: Suggestion[]): Suggestion[] => {
  return suggestions.filter((s) => s.name.length > 0);
};

export const getSubcommandDrivenRecommendation = async (
  subcommand: Fig.Subcommand,
  persistentOptions: Fig.Option[],
  partialToken: CommandToken | undefined,
  argsDepleted: boolean,
  argsFromSubcommand: boolean,
  acceptedTokens: CommandToken[],
  allTokens: CommandToken[],
  cwd: string,
  shell: Shell,
  signal?: AbortSignal,
): Promise<SuggestionBlob | undefined> => {
  log.debug({ msg: "suggestion point", subcommand, persistentOptions, partialToken, argsDepleted, argsFromSubcommand, acceptedTokens, cwd });
  if (argsDepleted && argsFromSubcommand) {
    return;
  }
  let partialCmd = partialToken?.token;
  if (partialToken?.isPath) {
    partialCmd = partialToken.isPathComplete ? "" : path.basename(partialCmd ?? "");
  }

  const lastToken = allTokens.at(-1);
  const suggestions: Suggestion[] = [];
  const argLength = subcommand.args instanceof Array ? subcommand.args.length : subcommand.args ? 1 : 0;
  const allOptions = persistentOptions.concat(subcommand.options ?? []);

  if (!argsFromSubcommand) {
    suggestions.push(...subcommandSuggestions(subcommand.subcommands, subcommand.filterStrategy, partialCmd));
    suggestions.push(...optionSuggestions(allOptions, acceptedTokens, subcommand.filterStrategy, partialCmd));
  }
  if (argLength != 0) {
    const activeArg = subcommand.args instanceof Array ? subcommand.args[0] : subcommand.args;
    const debounce = activeArg?.debounce === true;
    suggestions.push(...(await generatorSuggestions(activeArg?.generators, allTokens, activeArg?.filterStrategy, partialCmd, cwd, debounce, shell, signal)));
    suggestions.push(...suggestionSuggestions(activeArg?.suggestions, activeArg?.filterStrategy, partialCmd));
    suggestions.push(...(await templateSuggestions(activeArg?.template, activeArg?.filterStrategy, partialCmd, cwd, signal)));
  }

  return {
    suggestions: removeDuplicateSuggestion(
      removeEmptySuggestion(
        removeHiddenSuggestions(
          removeHomeDirectorySuggestion(
            removeAcceptedSuggestions(
              adjustPathSuggestions(
                sortSuggestions(keepPathMatches(suggestions, partialToken, shell), partialCmd, historyScore(allTokens, cwd), orderRankOf(allTokens)),
                partialToken,
                lastToken,
                shell,
              ),
              acceptedTokens,
            ),
            allTokens,
          ),
          partialToken,
        ),
      ),
    ),
  };
};

export const getArgDrivenRecommendation = async (
  args: Fig.Arg[],
  subcommand: Fig.Subcommand,
  persistentOptions: Fig.Option[],
  partialToken: CommandToken | undefined,
  acceptedTokens: CommandToken[],
  allTokens: CommandToken[],
  variadicArgBound: boolean,
  cwd: string,
  shell: Shell,
  signal?: AbortSignal,
): Promise<SuggestionBlob | undefined> => {
  let partialCmd = partialToken?.token;
  if (partialToken?.isPath) {
    partialCmd = partialToken.isPathComplete ? "" : path.basename(partialCmd ?? "");
  }

  const lastToken = allTokens.at(-1);
  const activeArg = args[0];
  const allOptions = persistentOptions.concat(subcommand.options ?? []);
  const debounce = activeArg?.debounce === true;
  const suggestions = [
    ...(await generatorSuggestions(args[0].generators, allTokens, activeArg?.filterStrategy, partialCmd, cwd, debounce, shell, signal)),
    ...suggestionSuggestions(args[0].suggestions, activeArg?.filterStrategy, partialCmd),
    ...(await templateSuggestions(args[0].template, activeArg?.filterStrategy, partialCmd, cwd, signal)),
  ];

  if (activeArg.isOptional || (activeArg.isVariadic && variadicArgBound)) {
    suggestions.push(...subcommandSuggestions(subcommand.subcommands, activeArg?.filterStrategy, partialCmd));
    suggestions.push(...optionSuggestions(allOptions, acceptedTokens, activeArg?.filterStrategy, partialCmd));
  }

  return {
    suggestions: removeDuplicateSuggestion(
      removeEmptySuggestion(
        removeHiddenSuggestions(
          removeHomeDirectorySuggestion(
            removeAcceptedSuggestions(
              adjustPathSuggestions(
                sortSuggestions(keepPathMatches(suggestions, partialToken, shell), partialCmd, historyScore(allTokens, cwd), orderRankOf(allTokens)),
                partialToken,
                lastToken,
                shell,
              ),
              acceptedTokens,
            ),
            allTokens,
          ),
          partialToken,
        ),
      ),
    ),
    argumentDescription: activeArg.description ?? activeArg.name,
  };
};
