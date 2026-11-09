// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { augmentGit, gitAliases } from "../../runtime/extras/git.js";

type N = { name?: string | string[]; description?: string; args?: unknown; subcommands?: N[] };
const spec = (): N => ({
  name: "git",
  subcommands: [
    { name: "checkout", args: { name: "branch" }, description: "Switch branches" },
    { name: "commit", args: { name: "pathspec" }, description: "Record changes" },
    { name: "stash", subcommands: [{ name: "pop" }, { name: "apply" }] },
    { name: "log", description: "Show logs" },
    { name: "status", description: "Show the working tree status" },
  ],
});

const aliases: [string, string, string | undefined][] = [
  ["co", "checkout", "branch"],
  ["ci", "commit -v", "pathspec"],
  ["st", "status -sb", undefined],
  ["lg", "log --oneline --graph", undefined],
  ["sp", "stash pop", undefined],
  ["wip", "!git add -A && git commit -m wip", undefined],
  ["unknown", "frobnicate", undefined],
];

describe("git aliases complete like the command behind them", () => {
  const root = spec();
  augmentGit(
    root as never,
    aliases.map(([name, expansion]) => ({ name, expansion })),
  );
  test.each(aliases)("%s = %s", (name, expansion, argName) => {
    const entry = root.subcommands?.find((s) => s.name === name);
    expect(entry?.description).toBe(`alias: ${expansion}`);
    expect((entry?.args as { name?: string } | undefined)?.name).toBe(argName);
  });
  test("an alias named like a real subcommand does not replace it", () => {
    const r = spec();
    augmentGit(r as never, [{ name: "status", expansion: "log" }]);
    expect(r.subcommands?.filter((s) => s.name === "status")).toHaveLength(1);
    expect(r.subcommands?.find((s) => s.name === "status")?.description).toBe("Show the working tree status");
  });
  test("the same alias twice is added once", () => {
    const r = spec();
    augmentGit(r as never, [
      { name: "co", expansion: "checkout" },
      { name: "co", expansion: "commit" },
    ]);
    expect(r.subcommands?.filter((s) => s.name === "co")).toHaveLength(1);
  });
});

describe("reading aliases from git config", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "thint-alias-"));
  // an empty file of its own: git on Windows cannot read its config from the null device
  const emptyConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "thint-gitconfig-")), "config");
  fs.writeFileSync(emptyConfig, "");
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repo, env: { ...process.env, GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_NOSYSTEM: "1" } });
  // only this repository's aliases, whatever the machine has in its own git config
  const saved = { global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_NOSYSTEM };
  afterAll(() => {
    process.env.GIT_CONFIG_GLOBAL = saved.global;
    process.env.GIT_CONFIG_NOSYSTEM = saved.system;
    if (saved.global == null) delete process.env.GIT_CONFIG_GLOBAL;
    if (saved.system == null) delete process.env.GIT_CONFIG_NOSYSTEM;
  });
  beforeAll(() => {
    process.env.GIT_CONFIG_GLOBAL = emptyConfig;
    process.env.GIT_CONFIG_NOSYSTEM = "1";
    git("init", "-q");
    git("config", "alias.co", "checkout");
    git("config", "alias.lg", "log --oneline --graph --decorate");
    git("config", "alias.wip", "!git add -A && git commit -m 'wip'");
    git("config", "alias.dash-name", "status");
  });
  afterAll(() => fs.rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const expected: [string, string][] = [
    ["co", "checkout"],
    ["lg", "log --oneline --graph --decorate"],
    ["wip", "!git add -A && git commit -m 'wip'"],
    ["dash-name", "status"],
  ];
  test.each(expected)("%s", (name, expansion) => {
    const found = gitAliases(repo).find((a) => a.name === name);
    expect(found?.expansion).toBe(expansion);
  });
  test("outside a repository nothing breaks", () => expect(Array.isArray(gitAliases(os.tmpdir()))).toBe(true));
});
