// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Runs a program and gives back its output, or "" when it is missing, fails or takes too long. Never throws.
export const run = (command: string, args: string[], cwd?: string, timeout = 1500): Promise<string> =>
  new Promise((resolve) => {
    try {
      execFile(command, args, { cwd, timeout, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, NO_COLOR: "1" } }, (error, stdout) =>
        resolve(error != null && !stdout ? "" : String(stdout)),
      );
    } catch {
      resolve("");
    }
  });

// Remembers an answer for a while per key, and shares one call between requests made at the same time.
export const memo = <T>(ttlMs: number) => {
  const entries = new Map<string, { at: number; value: Promise<T> }>();
  return (key: string, make: () => Promise<T>): Promise<T> => {
    const hit = entries.get(key);
    if (hit != null && Date.now() - hit.at < ttlMs) return hit.value;
    const value = make();
    entries.set(key, { at: Date.now(), value });
    if (entries.size > 200) entries.delete(entries.keys().next().value as string);
    return value;
  };
};

export const findUp = (start: string, names: string[]): string | undefined => {
  let dir = path.resolve(start);
  for (;;) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
};

export const readText = (file: string): string => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
};

// the way git says it: "6 seconds ago", "3 minutes ago", "2 days ago"
export const relativeAge = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"} ago`;
  if (s < 90) return unit(s, "second");
  const m = Math.round(s / 60);
  if (m < 90) return unit(m, "minute");
  const h = Math.round(m / 60);
  if (h < 36) return unit(h, "hour");
  const d = Math.round(h / 24);
  if (d < 14) return unit(d, "day");
  if (d < 70) return unit(Math.round(d / 7), "week");
  if (d < 365) return unit(Math.round(d / 30), "month");
  return unit(Math.round(d / 365), "year");
};

export const tildify = (dir: string, home = process.env.HOME ?? ""): string =>
  home && (dir === home || dir.startsWith(home + path.sep)) ? "~" + dir.slice(home.length) : dir;

// Levenshtein distance, stops early once it is past `max`
export const editDistance = (a: string, b: string, max = 3): number => {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let before: number[] = [];
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      // a swap of two neighbours counts as one edit: "gti" for "git"
      let value = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, (before[j - 2] ?? value) + 1);
      cur.push(value);
      best = Math.min(best, value);
    }
    if (best > max) return max + 1;
    before = prev;
    prev = cur;
  }
  return prev[b.length];
};

// the closest name to `word`, if it is near enough to be a typo
export const closest = (word: string, names: Iterable<string>, max = word.length <= 4 ? 1 : 2): string | undefined => {
  let best: string | undefined;
  let bestScore = max + 1;
  const sorted = [...word].sort().join("");
  for (const name of names) {
    if (name === word) continue;
    const d = editDistance(word, name, max);
    if (d > max) continue;
    // on a tie, a name of the same length wins (a swap or a wrong letter, "gti" → git rather than gt), and one
    // made of the same letters wins over that
    const score = d + (name.length === word.length ? 0 : 0.5) - ([...name].sort().join("") === sorted ? 0.25 : 0);
    if (score < bestScore) {
      best = name;
      bestScore = score;
    }
  }
  return best;
};

// Words that look like secrets never get stored or shown from history: values after --token or --password,
// NAME_KEY=value assignments, and long random strings.
export const looksSecret = (command: string): boolean =>
  /(--?(token|password|passwd|secret|api[-_]?key|auth)[= ]\S)|(\b[A-Z0-9_]*(TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|PRIVATE_KEY)[A-Z0-9_]*=\S)|(\b(ghp|gho|github_pat|sk|xox[abp]|AKIA)[-_A-Za-z0-9]{12,})/i.test(
    command,
  ) || /\b(?=[A-Za-z0-9+/_-]*\d)(?=[A-Za-z0-9+/_-]*[a-z])(?=[A-Za-z0-9+/_-]*[A-Z])[A-Za-z0-9+/_-]{32,}\b/.test(command);
