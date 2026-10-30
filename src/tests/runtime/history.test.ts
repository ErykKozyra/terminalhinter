// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ageWeight, contextOf, frecency, normalizeValue, recordCommand, resetHistory, topCommands, topValues } from "../../runtime/history.js";
import { getSuggestions } from "../../runtime/runtime.js";
import { parseCommand } from "../../runtime/parser.js";
import { unpackResources } from "../../utils/node.js";
import { Shell } from "../../utils/shell.js";

const tokens = (cmd: string) => parseCommand(cmd + " ", Shell.Bash);
const hour = 3600_000;

let dir: string;
beforeAll(async () => {
  await unpackResources();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "thint-history-"));
  process.env.THINT_HISTORY_FILE = path.join(dir, "history.jsonl");
  for (const name of ["alpha", "beta", "gamma"]) fs.mkdirSync(path.join(dir, name));
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
beforeEach(() => resetHistory());

test("recent use weighs more than old use", () => {
  expect(ageWeight(0)).toBeGreaterThan(ageWeight(2 * hour));
  expect(ageWeight(2 * hour)).toBeGreaterThan(ageWeight(3 * 24 * hour));
  expect(ageWeight(3 * 24 * hour)).toBeGreaterThan(ageWeight(30 * 24 * hour));
});

test("the context is the command and subcommands, without options", () => {
  expect(contextOf(tokens("git checkout -b"))).toBe("git checkout");
});

test("paths are stored absolute, other values as typed", () => {
  expect(normalizeValue("gamma/", dir)).toBe(path.join(dir, "gamma"));
  expect(normalizeValue("main", dir)).toBe("main");
});

test("each argument is remembered under the words before it", () => {
  recordCommand(tokens("git checkout feature/login"), dir);
  recordCommand(tokens("git checkout feature/login"), dir);
  recordCommand(tokens("git checkout main"), dir);
  expect(frecency("git checkout", "feature/login")).toBeGreaterThan(frecency("git checkout", "main"));
  expect(topValues("git checkout", 1)).toEqual([{ value: "feature/login", score: expect.any(Number) }]);
  expect(frecency("git", "checkout")).toBeGreaterThan(0);
});

test("cd offers the folder you use most first, even right after the space", async () => {
  recordCommand(tokens("cd gamma"), dir);
  const suggestions = await getSuggestions("cd ", dir, Shell.Bash);
  expect(suggestions?.suggestions.at(0)?.name).toBe("gamma");
});

test("without history the order is unchanged", async () => {
  const suggestions = await getSuggestions("cd ", dir, Shell.Bash);
  expect(suggestions?.suggestions.slice(0, 3).map((s) => s.name)).toEqual(["alpha", "beta", "gamma"]);
});

test("the most used commands come from the recorded arguments", () => {
  resetHistory([
    { context: "git checkout", value: "main", time: Date.now() },
    { context: "git", value: "status", time: Date.now() },
    { context: "pnpm", value: "dev", time: Date.now() },
  ]);
  expect(topCommands(5)).toEqual(["git", "pnpm"]);
});
