// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getSuggestions } from "../../runtime/runtime.js";
import { calculateReplacement } from "../../runtime/replacement.js";
import { unpackResources } from "../../utils/node.js";
import { Shell } from "../../utils/shell.js";

let root: string;
beforeAll(async () => {
  await unpackResources();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "thint-paths-"));
  fs.mkdirSync(path.join(root, "my dir", "sub folder"), { recursive: true });
  fs.mkdirSync(path.join(root, "other"));
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const suggest = (cmd: string) => getSuggestions(cmd, root, Shell.Zsh);
const names = async (cmd: string) => (await suggest(cmd))?.suggestions.map((s) => s.name) ?? [];

(process.platform === "win32" ? describe.skip : describe)("folders with spaces", () => {
  test("after an escaped space the list shows that folder's contents", async () => {
    expect(await names("cd my\\ dir/")).toEqual(["sub folder", ".."]);
    expect((await suggest("cd my\\ dir/"))?.isPathContext).toBe(true);
  });

  test("the same inside quotes", async () => {
    expect(await names("cd 'my dir/'")).toEqual(["sub folder", ".."]);
  });

  test("accepting a folder with a space inserts it quoted", async () => {
    const blob = await suggest("cd my\\ dir/su");
    const folder = blob?.suggestions.find((s) => s.name === "sub folder");
    expect(folder).toBeDefined();
    const action = calculateReplacement(blob?.activeToken, folder!);
    expect(action?.insertText).toBe('"my dir/sub folder/"');
  });
});

test("variables need their own first letter to match fuzzily", async () => {
  process.env.THINT_TEST_GHO = "1";
  process.env.HOTHINT_TEST = "1";
  const found = await names("echo $HOTH");
  expect(found).toContain("$HOTHINT_TEST");
  expect(found).not.toContain("$THINT_TEST_GHO");
});
