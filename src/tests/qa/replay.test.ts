// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// Key by key, the list must end up the same as for the whole line computed from scratch (scripts/qa/replay.ts runs
// this over a few hundred lines). Typed slowly, typed fast with aborted requests, fixed with Backspace, half pasted.

import { jest } from "@jest/globals";
import fs from "node:fs";

import { fingerprint, isolateHome, makeWorkspace, realisticLines, replay, replayModes, ReplayRuntime } from "./sweep.js";

const savedEnv = { ...process.env };
let runtime: ReplayRuntime & { loadLocalSpecsSet: () => Promise<void> };
let clearGeneratorState: () => void;
let cwd = "";

beforeAll(async () => {
  isolateHome();
  // specs print their own errors (a search without network); the live session sends console to the log
  for (const level of ["log", "error", "warn", "info", "debug"] as const) jest.spyOn(console, level).mockImplementation(() => {});
  const { unpackResources } = await import("../../utils/node.js");
  ({ clearGeneratorState } = await import("../../runtime/generatorCache.js"));
  runtime = (await import("../../runtime/runtime.js")) as never;
  await unpackResources();
  await runtime.loadLocalSpecsSet();
  cwd = makeWorkspace();
}, 60_000);

afterAll(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
  process.env = savedEnv;
});

// the version lines ask the npm registry; they run in the script, not on every test run
const lines = realisticLines.filter((line) => !line.includes("@"));

const fresh = async (line: string) => {
  clearGeneratorState();
  runtime.clearTransientSuggestionState();
  return fingerprint(await runtime.getSuggestions(line, cwd, "bash" as never).catch(() => undefined));
};

test.each(lines)(
  "%s",
  async (line) => {
    const expected = await fresh(line);
    if ((await fresh(line)) !== expected) return; // the list changes by itself (running processes)
    for (const mode of replayModes) {
      clearGeneratorState();
      expect({ mode, list: fingerprint(await replay(runtime, line, mode, cwd, "bash" as never)) }).toEqual({ mode, list: expected });
    }
  },
  60_000,
);
