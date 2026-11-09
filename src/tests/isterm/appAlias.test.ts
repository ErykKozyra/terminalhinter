// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { findAppAlias } from "../../isterm/pty.js";

// a link that points nowhere reads like an app alias of WindowsApps: stat() fails on it, lstat() does not
test("a shell that is a link stat() cannot read is still found on the PATH", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thint-alias-"));
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "thint-alias-"));
  try {
    const alias = path.join(dir, "pwsh.exe");
    try {
      fs.symlinkSync(path.join(dir, "nowhere"), alias);
    } catch {
      return; // Windows without the right to make links
    }
    expect(() => fs.statSync(alias)).toThrow();
    expect(findAppAlias("pwsh.exe", [empty, "", dir].join(path.delimiter))).toBe(alias);
    expect(findAppAlias("cmd.exe", [empty, dir].join(path.delimiter))).toBeUndefined();
    expect(findAppAlias(alias, dir)).toBeUndefined();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(empty, { recursive: true, force: true });
  }
});
