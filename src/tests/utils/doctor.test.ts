// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { configChecks, linesBeforeStartup, shellChecks } from "../../ui/ui-doctor.js";
import { beginMark, endMark, installStartupBlock, removeStartupBlock, startupBlock } from "../../utils/startupBlock.js";
import { Shell } from "../../utils/shell.js";

let dir: string;
beforeAll(() => (dir = fs.mkdtempSync(path.join(os.tmpdir(), "thint-doctor-"))));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

const block = `${beginMark}\nsource x\n${endMark}\n`;

test("counts the lines that run before the startup lines, ignoring comments and blank lines", () => {
  expect(linesBeforeStartup(`${block}\nexport A=1\n`, Shell.Zsh)).toBe(0);
  expect(linesBeforeStartup(`# my config\n\nexport A=1\nsource $ZSH/oh-my-zsh.sh\n${block}`, Shell.Zsh)).toBe(2);
  expect(linesBeforeStartup("export A=1\n", Shell.Zsh)).toBeUndefined();
});

test("the startup lines at the end are a warning, not an error", () => {
  const file = path.join(dir, ".zshrc");
  fs.writeFileSync(file, `export A=1\n${block}`);
  const checks = shellChecks(Shell.Zsh, file, true);
  expect(checks.some((c) => c.status === "warn" && c.text.includes("load twice"))).toBe(true);
  expect(checks.some((c) => c.status === "fail" && c.text.includes("no terminalhinter"))).toBe(false);
});

test("a login shell without startup lines is an error with the fix", () => {
  const file = path.join(dir, ".bashrc");
  fs.writeFileSync(file, "export A=1\n");
  expect(shellChecks(Shell.Bash, file, true)).toEqual([expect.objectContaining({ status: "fail", hint: "thint init" })]);
  expect(shellChecks(Shell.Bash, file, false)).toEqual([]);
});

test("a broken config is reported", () => {
  const file = path.join(dir, "rc");
  fs.writeFileSync(file, 'theme = "neon"\n');
  expect(configChecks([file])).toEqual([expect.objectContaining({ status: "fail" })]);
  fs.writeFileSync(file, "theme = \n");
  expect(configChecks([file])).toEqual([expect.objectContaining({ status: "fail", text: expect.stringContaining("not valid TOML") })]);
});

test("init --remove takes the block out and leaves the rest", () => {
  const file = path.join(dir, ".zshrc-remove");
  fs.writeFileSync(file, startupBlock(Shell.Zsh, undefined) + "\nexport A=1\n");
  expect(removeStartupBlock(Shell.Zsh, file)).toBe(file);
  expect(fs.readFileSync(file, "utf8")).toBe("export A=1\n");
  expect(removeStartupBlock(Shell.Zsh, file)).toBeUndefined();
});

test("a PowerShell profile keeps its byte order mark and CRLF line ends", () => {
  const file = path.join(dir, "Microsoft.PowerShell_profile.ps1");
  fs.writeFileSync(file, "\uFEFFSet-Alias ll Get-ChildItem\r\n$env:A = 'zażółć'\r\n");
  installStartupBlock(Shell.Pwsh, file);
  const text = fs.readFileSync(file, "utf8");
  expect(text.startsWith("\uFEFF" + beginMark + "\r\n")).toBe(true);
  expect(text).not.toMatch(/[^\r]\n/);
  expect(text.endsWith("Set-Alias ll Get-ChildItem\r\n$env:A = 'zażółć'\r\n")).toBe(true);
  expect(fs.readFileSync(file + ".before-terminalhinter", "utf8")).toBe("\uFEFFSet-Alias ll Get-ChildItem\r\n$env:A = 'zażółć'\r\n");
  // run again: one block, not two
  installStartupBlock(Shell.Pwsh, file);
  expect(fs.readFileSync(file, "utf8").split(beginMark).length).toBe(2);
  expect(removeStartupBlock(Shell.Pwsh, file)).toBe(file);
  expect(fs.readFileSync(file, "utf8")).toBe("\uFEFFSet-Alias ll Get-ChildItem\r\n$env:A = 'zażółć'\r\n");
});

test("PowerShell gets its own PATH line", () => {
  expect(startupBlock(Shell.Pwsh, "/opt/thint", "/home/u")).toContain('$env:PATH = "/opt/thint" + [IO.Path]::PathSeparator + $env:PATH');
  expect(startupBlock(Shell.Zsh, "/opt/thint", "/home/u")).toContain('export PATH="/opt/thint:$PATH"');
});
