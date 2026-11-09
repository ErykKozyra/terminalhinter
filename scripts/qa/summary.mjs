// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// Sums up the QA results of one run: live scenarios per system, shell and window size, and the unit tests.
//   node scripts/qa/summary.mjs <folder with live-*.json and unit-*.json> [--json out.json]

import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2];
const jsonOut = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : undefined;
const files = fs.readdirSync(dir);
const summary = { live: {}, unit: {}, failures: [] };

for (const file of files.filter((f) => f.startsWith("live-") && f.endsWith(".json"))) {
  // macOS runs one file per window size and shell (live-macos-latest-80x24.zsh.json): they add up under one system
  const os = file.slice(5, -5).replace(/-\d+x\d+(\.\w+)?$/, "");
  const data = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
  const cells = summary.live[os]?.cells ?? {};
  for (const r of data.results) {
    const key = `${r.shell} ${r.size}`;
    cells[key] ??= { passed: 0, failed: 0, flaky: 0, known: 0 };
    if (!r.ok && r.known) cells[key].known++;
    else if (!r.ok) cells[key].failed++;
    else if (r.flaky) cells[key].flaky++;
    else cells[key].passed++;
    if (!r.ok) summary.failures.push({ os, shell: r.shell, size: r.size, scenario: r.scenario, known: r.known, failures: r.failures.map((f) => f.slice(0, 1500)) });
  }
  summary.live[os] = { shells: [...new Set([...(summary.live[os]?.shells ?? []), ...(data.shells ?? [])])], cells };
}

for (const file of files.filter((f) => f.startsWith("unit-") && f.endsWith(".json"))) {
  const os = file.slice(5, -5);
  const data = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
  const failed = data.testResults.flatMap((s) =>
    s.assertionResults.filter((a) => a.status === "failed").map((a) => `${path.basename(s.name)}: ${a.fullName}: ${(a.failureMessages[0] ?? "").split("\n")[0].slice(0, 300)}`),
  );
  summary.unit[os] = { passed: data.numPassedTests, failed: data.numFailedTests, skipped: data.numPendingTests, failedTests: failed };
}

for (const [os, { cells }] of Object.entries(summary.live)) {
  console.log(`\n${os}`);
  for (const [key, c] of Object.entries(cells).sort()) console.log(`  ${key.padEnd(18)} ${c.passed} passed  ${c.flaky} flaky  ${c.failed} failed${c.known ? `  ${c.known} known` : ""}`);
}
for (const [os, u] of Object.entries(summary.unit)) {
  console.log(`\nunit ${os}: ${u.passed} passed, ${u.failed} failed, ${u.skipped} skipped`);
  for (const f of u.failedTests.slice(0, 30)) console.log(`  ✗ ${f}`);
}
const byScenario = {};
for (const f of summary.failures.filter((f) => !f.known)) (byScenario[f.scenario] ??= []).push(`${f.os} ${f.shell} ${f.size}`);
console.log(`\nfailed scenarios (${Object.keys(byScenario).length}):`);
for (const [name, where] of Object.entries(byScenario).sort((a, b) => b[1].length - a[1].length)) console.log(`  ${String(where.length).padStart(3)}  ${name}  [${where.slice(0, 6).join(", ")}${where.length > 6 ? ", …" : ""}]`);
const known = summary.failures.filter((f) => f.known);
if (known.length) console.log(`\nknown (${known.length}): ${[...new Set(known.map((f) => `${f.scenario}: ${f.known}`))].join("; ")}`);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(summary, null, 2));
