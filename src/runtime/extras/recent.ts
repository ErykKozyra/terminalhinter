// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// Whole commands you ran, per folder: typing the first word of one you ran here before offers the whole line again,
// the most used and most recent first. Read from Atuin's history when Atuin is installed, kept by terminalhinter
// otherwise. Lines that look like they hold a secret are never stored or shown.

import fs from "node:fs";
import path from "node:path";

import { allResourcesPath } from "../../utils/constants.js";
import { ageWeight } from "../history.js";
import { findUp, looksSecret, memo, relativeAge, run } from "./util.js";

type Entry = { command: string; cwd: string; time: number };

const file = () => process.env.THINT_COMMANDS_FILE ?? path.join(allResourcesPath, "commands.jsonl");
const maxLines = 4000;
let entries: Entry[] | undefined;

const load = (): Entry[] => {
  if (entries != null) return entries;
  entries = [];
  try {
    for (const line of fs.readFileSync(file(), "utf8").split("\n")) {
      if (!line) continue;
      try {
        const e = JSON.parse(line) as Entry;
        if (typeof e.command === "string" && typeof e.cwd === "string") entries.push(e);
      } catch {
        /* a broken line is skipped */
      }
    }
  } catch {
    /* no file yet */
  }
  return entries;
};

export const rememberCommand = (command: string, cwd: string, now = Date.now()): void => {
  const text = command.trim();
  // single words (ls, pwd) are not worth a line of their own, and secrets never go to disk
  if (!/\s/.test(text) || text.length > 500 || looksSecret(text)) return;
  const list = load();
  const entry = { command: text, cwd, time: now };
  list.push(entry);
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    if (list.length > maxLines) {
      entries = list.slice(-Math.floor(maxLines * 0.75));
      fs.writeFileSync(file(), entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
    } else fs.appendFileSync(file(), JSON.stringify(entry) + "\n");
  } catch {
    /* an unwritable data folder only means no history */
  }
};

export const resetRecent = (list: Entry[] = []) => {
  entries = list;
};

const atuinCache = memo<Entry[]>(5000);
const hasAtuin = memo<boolean>(60_000);

const fromAtuin = (cwd: string): Promise<Entry[]> =>
  atuinCache(cwd, async () => {
    if (process.env.THINT_NO_ATUIN === "1") return [];
    const available = await hasAtuin("atuin", async () => (await run("atuin", ["--version"], undefined, 800)) !== "");
    if (!available) return [];
    const out = await run("atuin", ["search", "--cwd", cwd, "--limit", "200", "--format", "{time}\t{command}", "--exit", "0"], cwd, 1200);
    return out
      .split("\n")
      .map((line) => line.match(/^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\t(.+)$/))
      .filter((m): m is RegExpMatchArray => m != null)
      .map((m) => ({ command: m[2].trim(), cwd, time: Date.parse(m[1].replace(" ", "T") + "Z") || Date.now() }));
  });

type Ranked = { command: string; score: number; last: number; count: number; here?: boolean };

// the folder of the git repository around `cwd`, if there is one
const repoRootOf = (cwd: string): string | undefined => {
  const marker = findUp(cwd, [".git"]);
  return marker == null ? undefined : path.dirname(marker);
};

const inside = (dir: string, root: string) => dir === root || dir.startsWith(root.endsWith(path.sep) ? root : root + path.sep);

// Commands run in this folder count fully; ones run elsewhere in the same repository count a third as much,
// so `npm run dev` typed in the repo root also comes back in src/.
export const rankCommands = (list: Entry[], cwd: string, prefix: string, now = Date.now(), repoRoot?: string): Ranked[] => {
  const byCommand = new Map<string, Ranked>();
  for (const e of list) {
    const here = e.cwd === cwd;
    if (!here && (repoRoot == null || !inside(e.cwd, repoRoot))) continue;
    if (!e.command.startsWith(prefix) || looksSecret(e.command)) continue;
    const r = byCommand.get(e.command) ?? { command: e.command, score: 0, last: 0, count: 0, here: false };
    r.score += ageWeight(now - e.time) * (here ? 1 : 1 / 3);
    r.last = Math.max(r.last, e.time);
    r.count += 1;
    r.here ||= here;
    byCommand.set(e.command, r);
  }
  return [...byCommand.values()].sort((a, b) => b.score - a.score || b.last - a.last);
};

// up to `limit` whole commands for the first word being typed, ran in this folder or elsewhere in its repository
export const recentCommands = async (cwd: string, prefix: string, limit = 3): Promise<Ranked[]> => {
  if (prefix.length === 0) return [];
  const atuin = await fromAtuin(cwd);
  return rankCommands([...load(), ...atuin], cwd, prefix, Date.now(), repoRootOf(cwd)).slice(0, limit);
};

export const describeRecent = (r: Ranked, now = Date.now()) =>
  `${r.here === false ? "ran in this repo" : "ran here"} ${r.count > 1 ? `${r.count}×, last ` : ""}${relativeAge(now - r.last)}`;
