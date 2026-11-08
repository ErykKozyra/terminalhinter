// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// Layer 2 of the test plan: every spec thint knows, twelve lines each, through the real runtime.
//
//   npx tsx scripts/qa/spec-sweep.ts [results.json] [--only git,npm] [--shell bash|zsh|fish]
//
// A case fails on an exception, a timeout, a duplicate or empty entry, a newline in what gets inserted or ANSI in a
// description. Over 200 ms is "slow": "engine" when thint itself took the time, "generator" when most of it went
// to a command a spec runs (git, docker...), which is reported but does not fail the case.

import fs from "node:fs";

import { casesFor, CaseResult, isKnown, isolateHome, makeWorkspace, runCase } from "../../src/tests/qa/sweep.js";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args.splice(i, 2)[1];
};
const only = flag("--only")?.split(",");
const shellName = flag("--shell") ?? "bash";
const out = args[0];

isolateHome();
const { unpackResources } = await import("../../src/utils/node.js");
const { readMetric } = await import("../../src/utils/performance.js");
const { Shell } = await import("../../src/utils/shell.js");
const runtime = await import("../../src/runtime/runtime.js");
await unpackResources();
await runtime.loadLocalSpecsSet();

const shell = (Object.values(Shell) as string[]).includes(shellName) ? (shellName as never) : (Shell.Bash as never);
const cwd = makeWorkspace();
const specs = only ?? runtime.getSpecNames();
const results: CaseResult[] = [];
const loads: { spec: string; ms: number; generatorMs: number; error?: string }[] = [];
const generatorTotal = () => readMetric("runtime.runGenerator")?.totalMilliseconds ?? 0;
// specs print their own errors (a generator whose JSON did not parse); the live session sends console to the log
const say = (text: string) => process.stdout.write(text + "\n");
console.log = console.error = console.warn = console.info = console.debug = () => {};
const started = performance.now();

for (const [i, spec] of specs.entries()) {
  const t = performance.now();
  const g = generatorTotal();
  let cases;
  try {
    cases = await casesFor(runtime as never, spec, cwd, shell);
    loads.push({ spec, ms: performance.now() - t, generatorMs: generatorTotal() - g });
  } catch (e) {
    loads.push({ spec, ms: performance.now() - t, generatorMs: generatorTotal() - g, error: (e as Error).message });
    continue;
  }
  for (const c of cases) results.push(await runCase(runtime as never, readMetric, c, cwd, shell));
  if (process.stderr.isTTY && i % 20 === 0) process.stderr.write(`\r${i + 1}/${specs.length} ${spec}          `);
}
if (process.stderr.isTTY) process.stderr.write("\n");

const failed = results.filter((r) => r.problems.some((p) => !isKnown(r.spec, p)));
const known = results.filter((r) => r.problems.length > 0 && r.problems.every((p) => isKnown(r.spec, p)));
const engineSlow = results.filter((r) => r.slow === "engine");
const generatorSlow = results.filter((r) => r.slow === "generator");
const byProblem = new Map<string, CaseResult[]>();
for (const r of failed)
  for (const p of r.problems.filter((p) => !isKnown(r.spec, p))) {
    const key = p.replace(/: .*/, "");
    byProblem.set(key, [...(byProblem.get(key) ?? []), r]);
  }
const sorted = [...results].sort((a, b) => b.ms - a.ms);
const pct = (q: number) => {
  const ms = results.map((r) => r.ms).sort((a, b) => a - b);
  return ms[Math.min(ms.length - 1, Math.floor(ms.length * q))]?.toFixed(1);
};

say(
  `specs: ${specs.length}, cases: ${results.length}, passed: ${results.length - failed.length}, failed: ${failed.length}, known spec issues: ${known.length}`,
);
say(`load errors: ${loads.filter((l) => l.error).length}, total time: ${((performance.now() - started) / 1000).toFixed(1)} s`);
say(`time per case: p50 ${pct(0.5)} ms, p99 ${pct(0.99)} ms; slow (engine): ${engineSlow.length}, slow (generator): ${generatorSlow.length}`);
for (const [problem, rs] of byProblem) {
  say(`\n${problem}: ${rs.length}`);
  for (const r of rs.slice(0, 8)) say(`  ${r.spec} [${r.kind}] ${JSON.stringify(r.line)}: ${r.problems.join("; ")}`);
}
for (const l of loads.filter((l) => l.error)) say(`load error ${l.spec}: ${l.error}`);
say("\nslowest cases:");
for (const r of sorted.slice(0, 15)) say(`  ${r.ms.toFixed(0)} ms (generators ${r.generatorMs.toFixed(0)} ms) ${r.spec} ${JSON.stringify(r.line)}`);
say("\nslowest first loads (reading the spec and the first lists, without the commands specs run):");
for (const l of [...loads].sort((a, b) => b.ms - b.generatorMs - (a.ms - a.generatorMs)).slice(0, 10))
  say(`  ${(l.ms - l.generatorMs).toFixed(0)} ms ${l.spec} (generators ${l.generatorMs.toFixed(0)} ms)`);

if (out) fs.writeFileSync(out, JSON.stringify({ shell: shellName, specs: specs.length, loads, results }, null, 1));
fs.rmSync(cwd, { recursive: true, force: true });
process.exit(failed.length > 0 || engineSlow.length > 0 ? 1 : 0);
