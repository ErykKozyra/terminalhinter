// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// Shared by the spec sweep and the keystroke replay (scripts/qa) and by their small jest subsets: a project folder
// to run in, the lines to try for a command, and the checks every result has to pass.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Suggestion, SuggestionBlob } from "../../runtime/model.js";

export type Runtime = {
  getSuggestions: (cmd: string, cwd: string, shell: never, signal?: AbortSignal) => Promise<SuggestionBlob | undefined>;
};

export type Case = { spec: string; kind: string; line: string };

export type CaseResult = Case & {
  ms: number;
  generatorMs: number;
  count: number;
  problems: string[];
  slow?: "engine" | "generator";
};

export const caseKinds = [
  "empty",
  "subPrefix",
  "subSpace",
  "longOption",
  "shortOption",
  "optionArg",
  "afterDoubleDash",
  "quoted",
  "typo",
  "path",
  "secondLevel",
  "deepInvalid",
] as const;

// Sets HOME and the data folders to a temp folder before thint's modules are imported: they read the home folder
// once, at import. Everything thint writes (specs, history, update state) stays in there. Under jest, os.homedir()
// still sees the real HOME (the test gets its own copy of process.env), so the files thint finds by an environment
// variable are pointed at the temp folder too.
export const isolateHome = (): string => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "thint-qa-home-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.XDG_DATA_HOME;
  process.env.THINT_NO_UPDATE_CHECK = "1";
  process.env.THINT_NO_ATUIN = "1";
  process.env.THINT_NO_ZOXIDE = "1";
  process.env.THINT_COMMANDS_FILE = path.join(home, "commands.jsonl");
  process.env.THINT_SNIPPETS_FILE = path.join(home, "snippets.yaml");
  process.env.THINT_SPECS_DIR = path.join(home, ".config", "terminalhinter", "specs");
  process.env.ISTERM_PERF = "1";
  process.env.ISTERM_PERF_OUTPUT = path.join(home, "perf.json");
  return home;
};

// A small project: a git repo with a few branches and a tag, package.json scripts, a Makefile, folders and a file
// whose name has a space.
export const makeWorkspace = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thint-qa-ws-"));
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  };
  write("package.json", JSON.stringify({ name: "qa-app", version: "1.0.0", scripts: { dev: "vite", build: "tsc", test: "jest" } }, null, 2));
  write("Makefile", "build: ## Build it\n\tgo build\n\ntest: ## Run the tests\n\tgo test ./...\n");
  write("src/index.ts", "export {};\n");
  write("docs/guide.md", "# guide\n");
  write("dir with space/file.txt", "x\n");
  write("README.md", "# qa\n");
  try {
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=QA", "-c", "user.email=qa@example.com", ...args], { cwd: dir, stdio: "ignore" });
    git("init", "-q", "-b", "main");
    git("add", ".");
    git("commit", "-q", "-m", "first");
    git("branch", "feature/login");
    git("branch", "fix/typo");
    git("tag", "v1.0.0");
  } catch {
    // no git: the cases that need branches just find none
  }
  return dir;
};

const firstName = (s: Suggestion): string => s.allNames.find((n) => n.length > 0) ?? s.name;

// specs leave `type` empty on most subcommands; the runtime marks them with the subcommand icon
const isSubcommand = (s: Suggestion): boolean => s.type === "subcommand" || s.icon === "📦";

// a letter swap in the middle, the way people mistype: "status" -> "stauts"
export const typoOf = (word: string): string => {
  if (word.length < 3) return word + word.at(-1);
  const i = Math.floor(word.length / 2) - 1;
  return word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2);
};

// The twelve lines tried for one command, built from what the runtime itself offers after the command name.
export const casesFor = async (rt: Runtime, spec: string, cwd: string, shell: never): Promise<Case[]> => {
  const after = async (line: string) => (await rt.getSuggestions(line, cwd, shell).catch(() => undefined))?.suggestions ?? [];
  const top = await after(`${spec} `);
  const subs = top.filter(isSubcommand).map(firstName);
  const options = await after(`${spec} -`);
  const longOption = options.map(firstName).find((n) => n.startsWith("--"));
  const withArg = options.find((s) => s.args != null && s.args.length > 0);
  const argOption = withArg ? withArg.allNames.find((n) => n.startsWith("--")) ?? firstName(withArg) : longOption;
  const sub = subs[0];
  let second = "";
  if (sub) {
    const level2 = await after(`${spec} ${sub} `);
    const sub2 = level2.find(isSubcommand);
    second = sub2 ? firstName(sub2).slice(0, 2) : "";
  }
  const lines: Record<(typeof caseKinds)[number], string> = {
    empty: `${spec} `,
    subPrefix: sub ? `${spec} ${sub.slice(0, Math.min(2, sub.length))}` : `${spec} a`,
    subSpace: sub ? `${spec} ${sub} ` : `${spec} x `,
    longOption: `${spec} --`,
    shortOption: `${spec} -`,
    optionArg: argOption ? `${spec} ${argOption} ` : `${spec} --help `,
    afterDoubleDash: `${spec} -- `,
    quoted: sub ? `${spec} ${sub} "two words" ` : `${spec} "two words" `,
    typo: sub ? `${spec} ${typoOf(sub)}` : `${spec} zz`,
    path: `${spec} ./`,
    secondLevel: sub ? `${spec} ${sub} ${second}` : `${spec} src/`,
    deepInvalid: `${spec} zz yy xx ww --nope `,
  };
  return caseKinds.map((kind) => ({ spec, kind, line: lines[kind] }));
};

// Problems in withfig's spec data that are known and harmless, so they do not fail the sweep. Each one is a P3 in
// the test report.
export const knownIssues: Record<string, RegExp> = {
  // whole lines of dig options offered as one suggestion, on purpose
  dig: /^unquoted space: "(ANY \+noall|\+nocomments)/,
  dog: /^unquoted space: "(ANY \+noall|\+nocomments)/,
  // a subcommand named " write-values" with a leading space
  helmfile: /^unquoted space: " write-values"/,
};

export const isKnown = (spec: string, problem: string): boolean => knownIssues[spec]?.test(problem) === true;

// What every list must satisfy, whatever the command.
export const checkBlob = (blob: SuggestionBlob | undefined, line?: string): string[] => {
  const problems: string[] = [];
  if (blob == null) return problems;
  // after a space a new word starts, so nothing typed can be replaced by the entry you accept
  if (line != null && /\s$/.test(line) && blob.activeToken != null && blob.activeToken.token !== "")
    problems.push(`active word after a space: ${JSON.stringify(blob.activeToken.token)}`);
  // every entry has to fit the word being typed: its letters, in order, somewhere in one of its names (the list
  // matches by prefix, by substring and by letters in order). Only the part after the last / @ = , : counts, since
  // paths, versions and option values are matched from there.
  const typed = (blob.activeToken?.token ?? "").replace(/^["']/, "");
  const query = (typed.split(/[/@=,:]/).pop() ?? "").toLowerCase().replace(/^[-$]+/, "");
  const fits = (s: Suggestion) =>
    [...s.allNames, s.name, s.insertValue ?? ""].some((n) => {
      const word = n.toLowerCase();
      let at = 0;
      for (const c of word) if (c === query[at]) at++;
      return at >= query.length;
    });
  const seen = new Map<string, number>();
  for (const s of blob.suggestions) {
    if (query !== "" && s.kind == null && !fits(s)) problems.push(`unrelated entry for ${JSON.stringify(typed)}: ${s.name}`);
    // after `src/` only files and folders fit, or a value that really starts with `src/` (a branch `feature/x`)
    const pathy = s.type === "file" || s.type === "folder";
    if (typed.includes("/") && !pathy && s.kind == null && ![...s.allNames, s.insertValue ?? ""].some((n) => n.toLowerCase().startsWith(typed.toLowerCase())))
      problems.push(`not a path after ${JSON.stringify(typed)}: ${s.name}`);
    if (s.name == null || s.name.trim() === "") problems.push("empty name");
    if (/[\r\n]/.test(s.name ?? "")) problems.push(`newline in name: ${JSON.stringify(s.name)}`);
    if (s.insertValue != null && /[\r\n]/.test(s.insertValue) && s.kind == null) problems.push(`newline in insert text: ${JSON.stringify(s.insertValue)}`);
    // accepted as it is, a value with a space becomes two words on the line (two-word subcommands like
    // `stripe logs tail` are meant that way)
    if (s.insertValue == null && /\s/.test(s.name ?? "") && s.kind == null && s.icon !== "📦") problems.push(`unquoted space: ${JSON.stringify(s.name)}`);
    // eslint-disable-next-line no-control-regex
    if (s.description != null && /\u001b/.test(s.description)) problems.push(`ANSI in description of ${s.name}`);
    const key = `${s.name}\u0000${s.insertValue ?? ""}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [key, n] of seen) if (n > 1) problems.push(`duplicate: ${key.split("\u0000")[0]} x${n}`);
  return problems;
};

// A stable picture of a list, to compare two runs of the same line.
export const fingerprint = (blob: SuggestionBlob | undefined): string =>
  JSON.stringify(
    blob == null
      ? null
      : {
          arg: blob.argumentDescription ?? null,
          active: blob.activeToken?.token ?? null,
          names: blob.suggestions.map((s) => [s.name, s.insertValue ?? null, s.description ?? null, s.risk ?? null, s.kind ?? null]),
        },
  );

type ReadMetric = (name: string) => { totalMilliseconds: number } | undefined;

export const runCase = async (rt: Runtime, readMetric: ReadMetric, c: Case, cwd: string, shell: never, timeoutMs = 10_000): Promise<CaseResult> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const generatorsBefore = readMetric("runtime.runGenerator")?.totalMilliseconds ?? 0;
  const start = performance.now();
  let blob: SuggestionBlob | undefined;
  const problems: string[] = [];
  try {
    blob = await rt.getSuggestions(c.line, cwd, shell, controller.signal);
  } catch (e) {
    problems.push(controller.signal.aborted ? `timeout after ${timeoutMs} ms` : `exception: ${(e as Error).message?.split("\n")[0]}`);
  } finally {
    clearTimeout(timer);
  }
  const ms = performance.now() - start;
  const generatorMs = (readMetric("runtime.runGenerator")?.totalMilliseconds ?? 0) - generatorsBefore;
  problems.push(...checkBlob(blob, c.line));
  const result: CaseResult = { ...c, ms, generatorMs, count: blob?.suggestions.length ?? 0, problems };
  if (ms > 200) result.slow = generatorMs >= ms / 2 ? "generator" : "engine";
  return result;
};

export type ReplayRuntime = Runtime & { clearTransientSuggestionState: () => void };

export type ReplayMode = "typed" | "fast" | "backspace" | "paste";
export const replayModes: ReplayMode[] = ["typed", "fast", "backspace", "paste"];

// The texts the line holds, key by key, the way they reach the runtime from the terminal.
export const keystrokes = (line: string, mode: ReplayMode): string[] => {
  const typed = (text: string, from = 1) => Array.from({ length: text.length - from + 1 }, (_, i) => text.slice(0, from + i));
  switch (mode) {
    case "typed":
    case "fast":
      return typed(line);
    case "backspace":
      // a typo at the end, then two Backspaces
      return [...typed(line + "xq"), line + "x", line];
    case "paste": {
      const half = Math.max(1, Math.floor(line.length / 2));
      return [...typed(line.slice(0, half)), line];
    }
  }
};

// Feeds the line through the runtime key by key and gives the list for the whole line. "fast" starts each request
// before the last one finished and aborts it, the way the list does when you type faster than it can answer.
export const replay = async (rt: ReplayRuntime, line: string, mode: ReplayMode, cwd: string, shell: never): Promise<SuggestionBlob | undefined> => {
  rt.clearTransientSuggestionState();
  const texts = keystrokes(line, mode);
  if (mode !== "fast") {
    let blob: SuggestionBlob | undefined;
    for (const text of texts) blob = await rt.getSuggestions(text, cwd, shell).catch(() => undefined);
    return blob;
  }
  let controller: AbortController | undefined;
  let last: Promise<SuggestionBlob | undefined> = Promise.resolve(undefined);
  for (const text of texts) {
    controller?.abort();
    controller = new AbortController();
    last = rt.getSuggestions(text, cwd, shell, controller.signal).catch(() => undefined);
    // a key every few milliseconds, faster than most generators answer
    await new Promise((r) => setTimeout(r, 3));
  }
  return await last;
};

// Lines people type, with a partial word at the end where the cache and the triggers matter most.
export const realisticLines = [
  "git checkout fe",
  "git checkout feature/",
  "git switch fi",
  'git commit -m "wip" --am',
  "git push origin ma",
  "git log --one",
  "git stash ",
  "git rebase -i HEAD",
  "git branch -D fe",
  "git add sr",
  "git diff --sta",
  "npm run d",
  "npm run te",
  "npm i -D type",
  "pnpm d",
  "pnpm run bu",
  "yarn te",
  "bun run de",
  "make bu",
  "make te",
  "cd sr",
  "cd docs/",
  'cd "dir with',
  "ls -la do",
  "ls src/in",
  "cat READ",
  "docker run --rm -it ub",
  "docker compose up -d",
  "kubectl get po",
  "kubectl logs -f ",
  "ssh -i ",
  "tar -xzvf ",
  "rm -rf no",
  "chmod +x sr",
  "curl -X PO",
  "brew install no",
  "cargo b",
  "python3 -m ven",
  "code .",
  "thint con",
  "claude --mo",
  "sudo git sta",
  "env FOO=1 git sta",
  "npx ti",
  "npm i react@1",
  "npm i -D typescript@5.",
  "pnpm add lodash@4.",
  "yarn add zod@",
  "bun add hono@4",
  "gh pr li",
];
