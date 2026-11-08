// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// The spec sweep (scripts/qa/spec-sweep.ts) on the commands people use most: twelve lines each, every list checked
// for exceptions, duplicates, empty names, newlines, ANSI, entries that do not fit the typed word and words that
// are not paths after a path. The full sweep over every spec is the script.

import { jest } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

import { casesFor, isKnown, isolateHome, makeWorkspace, runCase, Runtime } from "./sweep.js";

const popular = [
  "git",
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "npx",
  "docker",
  "docker-compose",
  "kubectl",
  "helm",
  "ssh",
  "scp",
  "cd",
  "ls",
  "cat",
  "rm",
  "cp",
  "mv",
  "mkdir",
  "chmod",
  "make",
  "cargo",
  "go",
  "python3",
  "pip",
  "node",
  "deno",
  "brew",
  "apt",
  "gh",
  "curl",
  "tar",
  "grep",
  "find",
  "kill",
  "code",
  "terraform",
  "vercel",
  "claude",
  "mise",
];

const savedEnv = { ...process.env };
let runtime: Runtime & { loadLocalSpecsSet: () => Promise<void>; getSpecNames: () => string[] };
let readMetric: (name: string) => { totalMilliseconds: number } | undefined;
let cwd = "";

beforeAll(async () => {
  isolateHome();
  // a spec whose generator answers a value with a space, the way killall lists process names
  const specsDir = process.env.THINT_SPECS_DIR ?? "";
  fs.mkdirSync(specsDir, { recursive: true });
  fs.writeFileSync(
    path.join(specsDir, "qa-quote.yaml"),
    ["name: qa-quote", "args:", "  name: value", "  script: \"echo 'two words'; echo one\""].join("\n") + "\n",
  );
  // specs print their own errors (a search without network); the live session sends console to the log
  for (const level of ["log", "error", "warn", "info", "debug"] as const) jest.spyOn(console, level).mockImplementation(() => {});
  const { unpackResources } = await import("../../utils/node.js");
  ({ readMetric } = await import("../../utils/performance.js"));
  runtime = (await import("../../runtime/runtime.js")) as never;
  await unpackResources();
  await runtime.loadLocalSpecsSet();
  cwd = makeWorkspace();
}, 60_000);

afterAll(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
  process.env = savedEnv;
});

test.each(popular)(
  "%s: twelve lines without a broken list",
  async (spec) => {
    if (!runtime.getSpecNames().includes(spec)) return;
    const cases = await casesFor(runtime, spec, cwd, "bash" as never);
    expect(cases).toHaveLength(12);
    const problems: string[] = [];
    for (const c of cases) {
      const r = await runCase(runtime, readMetric, c, cwd, "bash" as never);
      for (const p of r.problems) if (!isKnown(spec, p)) problems.push(`${JSON.stringify(c.line)}: ${p}`);
      if (r.slow === "engine") problems.push(`${JSON.stringify(c.line)}: ${r.ms.toFixed(0)} ms in thint itself`);
    }
    expect(problems).toEqual([]);
  },
  60_000,
);

describe("found by the sweep", () => {
  test("a path word lists only files and folders", async () => {
    const names = (await runtime.getSuggestions("git src/", cwd, "bash" as never))?.suggestions.map((s) => s.name) ?? [];
    expect(names).not.toContain("commit");
    expect((await runtime.getSuggestions("ls src/", cwd, "bash" as never))?.suggestions.map((s) => s.name)).toEqual(["index.ts"]);
  });
  test("a generated value with a space goes in quoted", async () => {
    const list = (await runtime.getSuggestions("qa-quote ", cwd, "bash" as never))?.suggestions ?? [];
    expect(list.map((s) => [s.name, s.insertValue])).toEqual([
      ["two words", '"two words"'],
      ["one", undefined],
    ]);
  });
  test("a folder of specs is not a command", async () => {
    expect(runtime.getSpecNames()).not.toContain("example");
    await expect(runtime.getSuggestions("example ", cwd, "bash" as never)).resolves.toBeUndefined();
  });
});
