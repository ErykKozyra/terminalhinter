// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// Folder jumps for `cd`: your bookmarks and the folders you visit most, from anywhere on disk, offered after the
// folders of the current directory. `cd tur` from your home folder finds ~/Work/clones/turbo-cloned.

import fs from "node:fs";
import fsAsync from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Suggestion } from "./model.js";
import { topValues } from "./history.js";
import { isSubsequence, SuggestionIcons } from "./suggestion.js";
import { allResourcesPath } from "../utils/constants.js";
import { getConfig } from "../utils/config.js";

export type Bookmark = { name: string; path: string };

export const jumpCommands = new Set(["cd", "pushd"]);
const maxJumps = 5;

const bookmarksPath = () => process.env.THINT_BOOKMARKS_FILE ?? path.join(allResourcesPath, "bookmarks.json");

export const readBookmarks = (): Bookmark[] => {
  try {
    const parsed = JSON.parse(fs.readFileSync(bookmarksPath(), "utf8")) as Bookmark[];
    return Array.isArray(parsed) ? parsed.filter((b) => typeof b?.name === "string" && typeof b?.path === "string") : [];
  } catch {
    return [];
  }
};

export const writeBookmarks = async (bookmarks: Bookmark[]): Promise<void> => {
  await fsAsync.mkdir(path.dirname(bookmarksPath()), { recursive: true });
  await fsAsync.writeFile(bookmarksPath(), JSON.stringify(bookmarks, null, 2) + "\n");
};

// ~/Work/clones/turbo-cloned instead of /Users/eryk/Work/clones/turbo-cloned
export const tildify = (dir: string): string => {
  const home = os.homedir();
  return dir === home ? "~" : dir.startsWith(home + path.sep) ? "~" + dir.slice(home.length) : dir;
};

const escapeForShell = (value: string) => value.replace(/([ '"()&;|<>$`\\!*?[\]{}#])/g, "\\$1");

const matches = (candidate: string, query: string): boolean => {
  if (query.length === 0) return true;
  const lower = candidate.toLowerCase();
  return (
    lower.startsWith(query) ||
    lower.includes(query) ||
    (getConfig().fuzzyMatching && query.length >= 2 && lower.startsWith(query[0]) && isSubsequence(lower, query))
  );
};

const toSuggestion = (dir: string, description: string, priority: number): Suggestion => {
  const shown = tildify(dir);
  const insert = shown.startsWith("~") ? "~" + escapeForShell(shown.slice(1)) : escapeForShell(shown);
  return {
    name: `${shown}/`,
    allNames: [`${shown}/`],
    insertValue: `${insert}/`,
    description,
    icon: SuggestionIcons.Special,
    priority,
  };
};

// `partial` is the word being typed after `cd` (empty right after the space); paths with a slash are left to the
// normal folder suggestions.
export const jumpSuggestions = (partial: string, cwd: string, alreadyShown: Suggestion[]): Suggestion[] => {
  if (partial.includes("/") || partial.startsWith(".") || partial.startsWith("~")) return [];
  const query = partial.toLowerCase();
  const seen = new Set<string>([path.resolve(cwd)]);
  // folders already listed from the current directory stay where they are
  for (const s of alreadyShown) seen.add(path.resolve(cwd, (s.insertValue ?? s.name).replace(/\/+$/, "")));

  const out: Suggestion[] = [];
  for (const bookmark of readBookmarks()) {
    const dir = path.resolve(bookmark.path.replace(/^~(?=$|\/)/, os.homedir()));
    if (seen.has(dir) || !(matches(bookmark.name, query) || matches(path.basename(dir), query))) continue;
    seen.add(dir);
    out.push(toSuggestion(dir, `bookmark "${bookmark.name}"`, 70));
  }
  for (const { value } of topValues("cd", 50).concat(topValues("pushd", 20))) {
    if (out.length >= maxJumps) break;
    if (!path.isAbsolute(value) || seen.has(value) || !matches(path.basename(value), query)) continue;
    try {
      if (!fs.statSync(value).isDirectory()) continue;
    } catch {
      continue;
    }
    seen.add(value);
    out.push(toSuggestion(value, "frequent folder", 65));
  }
  return out.slice(0, maxJumps);
};
