// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// git beyond branches: stashes with their message and age, worktrees with their branch, the reflog for undoing a
// reset, and your own aliases from .gitconfig as subcommands that complete like the command they stand for.

import { execFileSync } from "node:child_process";
import path from "node:path";

import { memo, relativeAge, run, tildify } from "./util.js";

const stashCache = memo<Fig.Suggestion[]>(3000);
const worktreeCache = memo<Fig.Suggestion[]>(3000);
const reflogCache = memo<Fig.Suggestion[]>(3000);

export const stashGenerator: Fig.Generator = {
  custom: async (_tokens, _execute, context) =>
    stashCache(context.currentWorkingDirectory, async () => {
      const out = await run("git", ["stash", "list", "--format=%gd%x09%ct%x09%gs"], context.currentWorkingDirectory);
      return out
        .split("\n")
        .filter(Boolean)
        .map((line, i) => {
          const [ref, time, subject] = line.split("\t");
          const message = (subject ?? "").replace(/^(WIP on|On) [^:]+: /, "");
          return { name: ref, description: `${relativeAge(Date.now() - Number(time) * 1000)} · ${message}`, priority: 90 - Math.min(i, 30) };
        });
    }),
};

export const worktreeGenerator: Fig.Generator = {
  custom: async (_tokens, _execute, context) =>
    worktreeCache(context.currentWorkingDirectory, async () => {
      const out = await run("git", ["worktree", "list", "--porcelain"], context.currentWorkingDirectory);
      const trees: Fig.Suggestion[] = [];
      for (const block of out.split("\n\n")) {
        const dir = block.match(/^worktree (.+)$/m)?.[1];
        if (!dir) continue;
        const branch = block.match(/^branch refs\/heads\/(.+)$/m)?.[1] ?? (/^detached$/m.test(block) ? "detached" : "bare");
        const locked = /^locked/m.test(block) ? " · locked" : "";
        // the path as short as it can be written: relative when it is close by, with ~ otherwise
        const relative = path.relative(context.currentWorkingDirectory, dir);
        const shown = relative && !relative.startsWith("../../") && relative.length < tildify(dir).length ? relative : tildify(dir);
        trees.push({ name: shown, insertValue: `${shown.replace(/ /g, "\\ ")} `, description: `${branch}${locked}`, priority: 80 });
      }
      // the first one is the main working tree, which cannot be removed
      return trees.slice(1);
    }),
};

export const reflogGenerator: Fig.Generator = {
  custom: async (_tokens, _execute, context) =>
    reflogCache(context.currentWorkingDirectory, async () => {
      const out = await run("git", ["reflog", "-n", "20", "--format=%gd%x09%ct%x09%gs"], context.currentWorkingDirectory);
      return out
        .split("\n")
        .filter(Boolean)
        .slice(1) // HEAD@{0} is where you are now
        .map((line, i) => {
          const [ref, time, subject] = line.split("\t");
          return { name: ref, description: `${relativeAge(Date.now() - Number(time) * 1000)} · ${subject}`, priority: 70 - i };
        });
    }),
};

type Node = {
  name?: Fig.SingleOrArray<string>;
  subcommands?: Node[];
  args?: Fig.SingleOrArray<Fig.Arg>;
  description?: string;
  priority?: number;
  icon?: string;
};
const names = (n: Node) => (n.name == null ? [] : Array.isArray(n.name) ? n.name : [n.name]);

const prependGenerator = (node: Node | undefined, generator: Fig.Generator, argName: string, replace = false) => {
  if (node == null) return;
  const first = (Array.isArray(node.args) ? node.args.at(0) : node.args) ?? { name: argName, isOptional: true };
  const existing = replace || first.generators == null ? [] : Array.isArray(first.generators) ? first.generators : [first.generators];
  if (existing.includes(generator)) return;
  (first as { generators?: Fig.Generator[] }).generators = [generator, ...existing];
  if (node.args == null) node.args = first;
  else if (Array.isArray(node.args)) node.args[0] = first;
};

// git aliases, read once per session; `!` aliases run a shell command and only get their description
export const gitAliases = (cwd?: string): { name: string; expansion: string }[] => {
  try {
    const out = execFileSync("git", ["config", "--get-regexp", "^alias\\."], { cwd, timeout: 1000, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out
      .split("\n")
      .map((line) => line.match(/^alias\.(\S+)\s+(.*)$/))
      .filter((m): m is RegExpMatchArray => m != null)
      .map((m) => ({ name: m[1], expansion: m[2].trim() }));
  } catch {
    return [];
  }
};

export const augmentGit = (root: Node, aliases = gitAliases()): void => {
  augmentGitExtras(root);
  addGitAliases(root, aliases);
};

const aliasCheck = new Map<string, number>();
// aliases can live in a repository's own .git/config and change while the shell runs: checked again every few
// seconds per folder, and new ones are added to the spec
export const refreshGitAliases = (root: Node, cwd: string, now = Date.now()): void => {
  if (now - (aliasCheck.get(cwd) ?? 0) < 5000) return;
  aliasCheck.set(cwd, now);
  addGitAliases(root, gitAliases(cwd));
};

const augmentGitExtras = (root: Node): void => {
  const sub = (...path: string[]): Node | undefined => {
    let node: Node | undefined = root;
    for (const part of path) node = node?.subcommands?.find((s) => names(s).includes(part));
    return node;
  };
  // the stash list git's own spec has shows the message as the name; ours names stash@{0} and describes it
  for (const name of ["apply", "pop", "drop", "show"]) prependGenerator(sub("stash", name), stashGenerator, "stash", true);
  for (const name of ["remove", "lock", "unlock", "move", "repair"]) prependGenerator(sub("worktree", name), worktreeGenerator, "worktree");
  prependGenerator(sub("reset"), reflogGenerator, "commit");
};

const addGitAliases = (root: Node, aliases: { name: string; expansion: string }[]): void => {
  const sub = (name: string): Node | undefined => root.subcommands?.find((s) => names(s).includes(name));
  const taken = new Set((root.subcommands ?? []).flatMap(names));
  for (const alias of aliases) {
    if (taken.has(alias.name)) continue;
    const target = alias.expansion.startsWith("!") ? undefined : sub(alias.expansion.split(/\s+/)[0]);
    taken.add(alias.name);
    const entry: Node = target != null ? { ...target } : {};
    entry.name = alias.name;
    entry.description = `alias: ${alias.expansion}`;
    entry.priority = 90;
    entry.icon = "🔥";
    root.subcommands = [...(root.subcommands ?? []), entry];
  }
};
