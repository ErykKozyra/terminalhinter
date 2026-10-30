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
export const NerdFontIcons = {
  alert: "\udb80\udc27",
  android: "\ue70e",
  apple: "\ue711",
  asterisk: "\uf069",
  aws: "\ue7ad",
  azure: "\ue754",
  box: "\uf1b2",
  carrot: "\uef3b",
  characters: "\udb82\udf34",
  commandkey: "\udb81\ude33",
  commit: "\ue729",
  cpu: "\uf4bc",
  database: "\ue706",
  discord: "\uf1ff",
  docker: "\ue7b0",
  firebase: "\ue787",
  flag: "\udb80\udd4f",
  gcloud: "\udb84\uddf6",
  git: "\ue702",
  github: "\ue709",
  gitlab: "\ue7eb",
  gradle: "\ue7f2",
  heroku: "\ue77b",
  invite: "\udb83\udebb",
  kubernetes: "\ue81d",
  netlify: "\ue83c",
  node: "\ued0d",
  npm: "\ued0e",
  slack: "\ue8a4",
  string: "\udb84\udc21",
  twitter: "\uf099",
  vercel: "\ue8d3",
  yarn: "\ue8ec",
};

const getIcon = (icon: string | undefined, suggestionType: Fig.SuggestionType | undefined): string => {
  // eslint-disable-next-line no-control-regex
  if (icon && /[^\u0000-\u00ff]/.test(icon)) {
    return icon;
  }
  if (icon && icon.startsWith("fig://icon?type=") && (getConfig().useNerdFont || getConfig().iconStyle === "nerd")) {
    const iconType = icon.split("fig://icon?type=")[1].toLowerCase();
    const iconUtf = NerdFontIcons[iconType as keyof typeof NerdFontIcons];
    if (iconUtf != null && iconUtf !== "") {
      return iconUtf;
    }
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
// Then by priority, and inside a priority band names that start with the typed text come before names that
// only contain it. Paths are also ranked by shorter names and alphabetically; everything else keeps its
// source order among equally good matches (the sort is stable), except values, where shorter names go first.
const sortSuggestions = (suggestions: Suggestion[], partialCmd: string | undefined, score: (s: Suggestion) => number = () => 0): Suggestion[] => {
  // how often and how recently you used each value here (see history.ts); computed once per suggestion
  const scores = new Map(suggestions.map((s) => [s, score(s)]));
  const used = (s: Suggestion) => scores.get(s) ?? 0;
  const sorted = suggestions.sort((a, b) => b.priority - a.priority || used(b) - used(a));
  if (!partialCmd) return sorted;
  const relevance = (s: Suggestion) => getMatchRelevance(s.name, partialCmd);
  const isExact = (s: Suggestion) => relevance(s) === 3;
  // values (scripts, branches, generator results) prefer the shorter name; subcommands and options keep the
  // spec's own order, which puts the popular ones first
  // (specs leave `type` empty on most subcommands, so they are recognized by the icon they were given)
  const isValue = (s: Suggestion) =>
    s.type !== "subcommand" && s.type !== "option" && s.icon !== SuggestionIcons.Subcommand && s.icon !== SuggestionIcons.Option && !s.name.startsWith("-");
  sorted.sort(
    (a, b) =>
      Number(isExact(b)) - Number(isExact(a)) ||
      b.priority - a.priority ||
      Math.min(relevance(b), 2) - Math.min(relevance(a), 2) ||
      used(b) - used(a) ||
      (isValue(a) && isValue(b) ? a.name.length - b.name.length : 0),
  );
  const pathIndexes = sorted.flatMap((s, i) => (getPathy(s.type) ? [i] : []));
  const rankedPaths = pathIndexes
    .map((i) => sorted[i])
    .sort(
      (a, b) =>
        Number(isExact(b)) - Number(isExact(a)) ||
        b.priority - a.priority ||
        relevance(b) - relevance(a) ||
        used(b) - used(a) ||
        a.name.length - b.name.length ||
        a.name.localeCompare(b.name),
    );
  pathIndexes.forEach((sortedIndex, rank) => (sorted[sortedIndex] = rankedPaths[rank]));
  return sorted;
};

// True when every character of `needle` appears in `haystack` in order: "icpl" matches "intercars.com.pl".
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
  if (!getConfig().fuzzyMatching) return false;
  // leading dashes are ignored, otherwise "--b" would match every option containing a "b"; the first letter must
  // match, which keeps the list short and is how people abbreviate ("icpl" for intercars.com.pl)
  const word = lower.replace(/^-+/, "");
  const typed = query.replace(/^-+/, "");
  return typed.length >= 2 && word.startsWith(typed[0]) && isSubsequence(word, typed);
};

// Scores each suggestion by your history in this spot: the context is the words before the one being typed, paths
// are compared as absolute paths (see history.ts).
const historyScore =
  (allTokens: CommandToken[], cwd: string) =>
  (s: Suggestion): number => {
    const before = allTokens.at(-1)?.complete === false ? allTokens.slice(0, -1) : allTokens;
    const context = contextOf(before);
    const value = getPathy(s.type) ? path.join(cwd, removePathSeparator(s.insertValue ?? s.name)) : (s.insertValue ?? s.name).trim();
    return frecency(context, value);
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

const removeAcceptedSuggestions = (suggestions: Suggestion[], acceptedTokens: CommandToken[]): Suggestion[] => {
  const seen = new Set<string>(acceptedTokens.map((t) => t.token));
  return suggestions.filter((s) => s.allNames.every((n) => !seen.has(n)));
};

const removeDuplicateSuggestion = (suggestions: Suggestion[]): Suggestion[] => {
  const seen = new Set<string>();
  return suggestions
    .map((s) => {
      if (seen.has(s.name)) return null;
      seen.add(s.name);
      return s;
    })
    .filter((s): s is Suggestion => s != null);
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
    suggestions.push(...(await generatorSuggestions(activeArg?.generators, allTokens, activeArg?.filterStrategy, partialCmd, cwd, debounce, signal)));
    suggestions.push(...suggestionSuggestions(activeArg?.suggestions, activeArg?.filterStrategy, partialCmd));
    suggestions.push(...(await templateSuggestions(activeArg?.template, activeArg?.filterStrategy, partialCmd, cwd, signal)));
  }

  return {
    suggestions: removeDuplicateSuggestion(
      removeEmptySuggestion(
        removeHiddenSuggestions(
          removeHomeDirectorySuggestion(
            removeAcceptedSuggestions(
              adjustPathSuggestions(sortSuggestions(suggestions, partialCmd, historyScore(allTokens, cwd)), partialToken, lastToken, shell),
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
    ...(await generatorSuggestions(args[0].generators, allTokens, activeArg?.filterStrategy, partialCmd, cwd, debounce, signal)),
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
              adjustPathSuggestions(sortSuggestions(suggestions, partialCmd, historyScore(allTokens, cwd)), partialToken, lastToken, shell),
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
