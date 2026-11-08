// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import { execFileSync } from "node:child_process";
import { buildExecuteShellCommand } from "../../runtime/utils.js";

const unixTest = process.platform === "win32" ? test.skip : test;

// a spec script that hangs (`sleep` started by the script's shell) must not outlive its timeout
const sleepers = (marker: string) =>
  execFileSync("ps", ["-eo", "args="], { encoding: "utf8" })
    .split("\n")
    .filter((line) => line.trim() === `sleep ${marker}`).length;

unixTest("a script that hangs is stopped with everything it started", async () => {
  const marker = String(900_000 + Math.floor(Math.random() * 99_999));
  const execute = buildExecuteShellCommand(300);
  const started = Date.now();
  const result = await execute({ command: "sh", args: ["-c", `sleep ${marker}; echo never`] });
  expect(Date.now() - started).toBeLessThan(3_000);
  expect(result.stdout).not.toContain("never");
  await new Promise((r) => setTimeout(r, 200));
  expect(sleepers(marker)).toBe(0);
});

unixTest("a script stopped because the line changed leaves nothing behind", async () => {
  const marker = String(900_000 + Math.floor(Math.random() * 99_999));
  const controller = new AbortController();
  const execute = buildExecuteShellCommand(60_000, controller.signal);
  const running = execute({ command: "sh", args: ["-c", `sleep ${marker}`] }).catch(() => undefined);
  await new Promise((r) => setTimeout(r, 300));
  controller.abort();
  await Promise.race([running, new Promise((r) => setTimeout(r, 3_000))]);
  await new Promise((r) => setTimeout(r, 200));
  expect(sleepers(marker)).toBe(0);
});
