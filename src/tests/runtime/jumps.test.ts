// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { recordCommand, resetHistory } from "../../runtime/history.js";
import { writeBookmarks } from "../../runtime/jumps.js";
import { getSuggestions } from "../../runtime/runtime.js";
import { parseCommand } from "../../runtime/parser.js";
import { unpackResources } from "../../utils/node.js";
import { Shell } from "../../utils/shell.js";

let root: string;
let here: string;
let far: string;
beforeAll(async () => {
  await unpackResources();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "thint-jumps-"));
  process.env.THINT_HISTORY_FILE = path.join(root, "history.jsonl");
  process.env.THINT_BOOKMARKS_FILE = path.join(root, "bookmarks.json");
  here = path.join(root, "home", "notes");
  far = path.join(root, "work", "clones", "turbo-cloned");
  fs.mkdirSync(path.join(here, "todo"), { recursive: true });
  fs.mkdirSync(far, { recursive: true });
  fs.mkdirSync(path.join(root, "projects", "shop"), { recursive: true });
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
beforeEach(async () => {
  resetHistory();
  await writeBookmarks([]);
});

const names = async (cmd: string) => (await getSuggestions(cmd, here, Shell.Zsh))?.suggestions.map((s) => s.name) ?? [];

test("a folder you went to before is offered from anywhere, after the local ones", async () => {
  recordCommand(parseCommand(`cd ${far} `, Shell.Zsh), here);
  expect(await names("cd tur")).toEqual([`${far}/`]);
  const all = await names("cd ");
  expect(all.indexOf(`${far}/`)).toBeGreaterThan(all.indexOf("todo"));
  expect(all.indexOf(`${far}/`)).toBeGreaterThan(all.indexOf(".."));
});

test("bookmarks match by their name", async () => {
  await writeBookmarks([{ name: "sklep", path: path.join(root, "projects", "shop") }]);
  const suggestions = (await getSuggestions("cd skl", here, Shell.Zsh))?.suggestions ?? [];
  expect(suggestions.map((s) => s.description)).toContain('bookmark "sklep"');
});

test("typing a path leaves jumps out", async () => {
  recordCommand(parseCommand(`cd ${far} `, Shell.Zsh), here);
  expect(await names("cd ./t")).not.toContain(`${far}/`);
});
