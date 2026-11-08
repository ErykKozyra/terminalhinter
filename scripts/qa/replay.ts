// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// Layer 3 of the test plan: a line typed key by key (slowly, fast with aborts, with a typo fixed by Backspace, half
// pasted) must end with the same list as the whole line computed from scratch. A difference means a cache or a
// trigger kept something stale.
//
//   npx tsx scripts/qa/replay.ts [results.json] [--specs 80]

import fs from "node:fs";

import { casesFor, fingerprint, isolateHome, makeWorkspace, realisticLines, replay, replayModes } from "../../src/tests/qa/sweep.js";

const args = process.argv.slice(2);
const specsAt = args.indexOf("--specs");
const specCount = specsAt === -1 ? 80 : Number(args.splice(specsAt, 2)[1]);
const out = args[0];

isolateHome();
const say = (text: string) => process.stdout.write(text + "\n");
console.log = console.error = console.warn = console.info = console.debug = () => {};
const { unpackResources } = await import("../../src/utils/node.js");
const { clearGeneratorState } = await import("../../src/runtime/generatorCache.js");
const { Shell } = await import("../../src/utils/shell.js");
const runtime = await import("../../src/runtime/runtime.js");
await unpackResources();
await runtime.loadLocalSpecsSet();
const shell = Shell.Bash as never;
const cwd = makeWorkspace();

// the commands people use most, then the rest in a fixed order, so a run is repeatable
const popular = [
  "git",
  "npm",
  "pnpm",
  "yarn",
  "docker",
  "kubectl",
  "ssh",
  "cd",
  "ls",
  "make",
  "cargo",
  "brew",
  "gh",
  "go",
  "python3",
  "pip",
  "node",
  "npx",
  "curl",
  "tar",
];
const names = runtime.getSpecNames();
const specs = [...new Set([...popular.filter((n) => names.includes(n)), ...names.filter((_, i) => i % 9 === 0)])].slice(0, specCount);
const lines = new Set(realisticLines);
for (const spec of specs) {
  const cases = await casesFor(runtime as never, spec, cwd, shell);
  for (const c of cases) if (["subPrefix", "typo", "secondLevel", "longOption"].includes(c.kind) && !c.line.endsWith(" ")) lines.add(c.line);
}

const fresh = async (line: string) => {
  clearGeneratorState();
  runtime.clearTransientSuggestionState();
  return fingerprint(await runtime.getSuggestions(line, cwd, shell).catch(() => undefined));
};

type Row = { line: string; mode: string; ok: boolean; skipped?: string; expected?: string; got?: string };
const rows: Row[] = [];
for (const line of lines) {
  const expected = await fresh(line);
  // lists that change by themselves (running processes, timestamps) cannot be compared
  if ((await fresh(line)) !== expected) {
    for (const mode of replayModes) rows.push({ line, mode, ok: true, skipped: "changes between runs" });
    continue;
  }
  for (const mode of replayModes) {
    clearGeneratorState();
    const got = fingerprint(await replay(runtime as never, line, mode, cwd, shell));
    rows.push(got === expected ? { line, mode, ok: true } : { line, mode, ok: false, expected, got });
  }
}

const failed = rows.filter((r) => !r.ok);
say(
  `lines: ${lines.size}, cases: ${rows.length}, passed: ${rows.length - failed.length}, failed: ${failed.length}, skipped: ${
    rows.filter((r) => r.skipped).length
  }`,
);
for (const r of failed.slice(0, 40)) {
  say(`\n${r.mode} ${JSON.stringify(r.line)}`);
  say(`  expected ${r.expected?.slice(0, 300)}`);
  say(`  got      ${r.got?.slice(0, 300)}`);
}
if (out) fs.writeFileSync(out, JSON.stringify(rows, null, 1));
fs.rmSync(cwd, { recursive: true, force: true });
process.exit(failed.length > 0 ? 1 : 0);
