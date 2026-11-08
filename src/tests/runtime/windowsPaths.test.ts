// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// What is inside a folder typed with either separator, in every shell of the system. On Windows cmd and PowerShell
// put `src\` on the line after Enter on a folder, so that has to list what is in src like `src/` does.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getSuggestions } from "../../runtime/runtime.js";
import { unpackResources } from "../../utils/node.js";
import { Shell } from "../../utils/shell.js";

let root: string;
beforeAll(async () => {
  await unpackResources();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "thint-winpaths-"));
  process.env.THINT_HISTORY_FILE = path.join(root, "history.jsonl");
  process.env.THINT_BOOKMARKS_FILE = path.join(root, "bookmarks.json");
  fs.mkdirSync(path.join(root, "src", "components"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "index.ts"), "");
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const names = async (cmd: string, shell: Shell) =>
  ((await getSuggestions(cmd, root, shell))?.suggestions ?? []).map((s) => String(s.name).replace(/[\\/]$/, ""));

const windows = process.platform === "win32";
const shells = windows ? [Shell.Pwsh, Shell.Powershell, Shell.Cmd, Shell.Bash] : [Shell.Bash, Shell.Zsh, Shell.Fish, Shell.Pwsh];
const lines = windows ? ["cd src\\", "cd src/", "ls src\\", "ls src/", "cd src\\comp", "cd src/comp"] : ["cd src/", "ls src/", "cd src/comp"];

describe.each(shells)("%s", (shell) => {
  test.each(lines)("%s lists what is in src", async (line) => {
    const got = await names(line, shell);
    expect(got).toContain("components");
    if (!line.endsWith("comp") && !line.startsWith("cd")) expect(got).toContain("index.ts");
  });
});
