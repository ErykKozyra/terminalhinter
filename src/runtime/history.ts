// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// Frecency: remembers which values you used where (the folder after `cd`, the branch after `git checkout`, the script
// after `pnpm`) and ranks them higher next time. Everything stays in one local file, nothing leaves the machine.

import fs from "node:fs";
import fsAsync from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { CommandToken } from "./parser.js";
import { allResourcesPath } from "../utils/constants.js";
import log from "../utils/log.js";

type Use = { context: string; value: string; time: number };

// THINT_HISTORY_FILE lets tests (or people who keep dotfiles elsewhere) choose another file
const historyPath = () => process.env.THINT_HISTORY_FILE ?? path.join(allResourcesPath, "history.jsonl");
const maxLines = 5000;
const keptLinesAfterCompaction = 3000;
const hour = 3600_000;

let uses: Use[] = [];
let scores = new Map<string, number>();
let loaded = false;

const key = (context: string, value: string) => `${context}\u0000${value}`;

// zoxide-style weights: what you used in the last hour counts four times as much as last week
export const ageWeight = (ageMs: number): number => (ageMs < hour ? 4 : ageMs < 24 * hour ? 2 : ageMs < 7 * 24 * hour ? 0.5 : 0.25);

const rebuildScores = (now: number) => {
  scores = new Map();
  for (const use of uses) {
    const k = key(use.context, use.value);
    scores.set(k, (scores.get(k) ?? 0) + ageWeight(now - use.time));
  }
};

// The words that set the context for a value: the command and subcommands typed before it, options left out.
export const contextOf = (tokens: CommandToken[]): string =>
  tokens
    .filter((t) => !t.isOption && !t.token.startsWith("-"))
    .map((t) => t.token)
    .join(" ");

const expandHome = (value: string) => (value === "~" || value.startsWith("~/") ? path.join(os.homedir(), value.slice(1)) : value);

// Paths are stored absolute, so a folder ranks the same no matter where you `cd` from. Anything that is not an
// existing path (a branch, a script name) is stored as typed.
export const normalizeValue = (value: string, cwd: string): string => {
  if (value === "-" || value.length === 0) return value;
  const absolute = path.resolve(cwd, expandHome(value));
  try {
    return fs.existsSync(absolute) ? absolute.replace(/\/+$/, "") || "/" : value;
  } catch {
    return value;
  }
};

export const loadHistory = async (): Promise<void> => {
  try {
    const text = await fsAsync.readFile(historyPath(), "utf8");
    const lines = text.split("\n").filter((l) => l.length > 0);
    uses = lines.flatMap((line) => {
      try {
        const { c, v, t } = JSON.parse(line) as { c: string; v: string; t: number };
        return typeof c === "string" && typeof v === "string" && typeof t === "number" ? [{ context: c, value: v, time: t }] : [];
      } catch {
        return [];
      }
    });
    if (lines.length > maxLines) {
      uses = uses.slice(-keptLinesAfterCompaction);
      await fsAsync.writeFile(historyPath(), uses.map((u) => JSON.stringify({ c: u.context, v: u.value, t: u.time })).join("\n") + "\n");
    }
  } catch {
    uses = [];
  }
  loaded = true;
  rebuildScores(Date.now());
};

// Called when a command is run: every argument is stored with the words before it as its context.
export const recordCommand = (tokens: CommandToken[], cwd: string, now = Date.now()): void => {
  const fresh: Use[] = [];
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens.at(i);
    if (token == null || token.isOption || token.token.startsWith("-")) continue;
    const value = normalizeValue(token.token, cwd);
    if (value.length === 0) continue;
    fresh.push({ context: contextOf(tokens.slice(0, i)), value, time: now });
  }
  if (fresh.length === 0) return;
  uses.push(...fresh);
  for (const use of fresh) {
    const k = key(use.context, use.value);
    scores.set(k, (scores.get(k) ?? 0) + ageWeight(0));
  }
  const lines = fresh.map((u) => JSON.stringify({ c: u.context, v: u.value, t: u.time })).join("\n") + "\n";
  fsAsync
    .mkdir(path.dirname(historyPath()), { recursive: true })
    .then(() => fsAsync.appendFile(historyPath(), lines))
    .catch((e) => log.debug({ msg: "could not save history", e: (e as Error).message }));
};

export const frecency = (context: string, value: string): number => (loaded || uses.length > 0 ? scores.get(key(context, value)) ?? 0 : 0);

// Values used most in this context, best first: lets `cd` offer folders from anywhere you go often.
export const topValues = (context: string, limit: number): { value: string; score: number }[] =>
  [...scores.entries()]
    .filter(([k]) => k.startsWith(`${context}\u0000`))
    .map(([k, score]) => ({ value: k.slice(context.length + 1), score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

// The commands you use most, judged by the arguments recorded for them.
export const topCommands = (limit: number): string[] => {
  const totals = new Map<string, number>();
  for (const [k, score] of scores) {
    const command = k.slice(0, k.indexOf("\u0000")).split(" ")[0];
    if (command) totals.set(command, (totals.get(command) ?? 0) + score);
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([command]) => command);
};

// for tests
export const resetHistory = (entries: Use[] = [], now = Date.now()) => {
  uses = entries;
  loaded = true;
  rebuildScores(now);
};
