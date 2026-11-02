// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { listOrders, orderRank, reloadOrder, resetOrder } from "../../runtime/order.js";
import { recordCommand, resetHistory } from "../../runtime/history.js";
import { getSuggestions, reorderSuggestions } from "../../runtime/runtime.js";
import { parseCommand } from "../../runtime/parser.js";
import { unpackResources } from "../../utils/node.js";
import { Shell } from "../../utils/shell.js";

let root: string;
beforeAll(async () => {
  await unpackResources();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "thint-order-"));
  process.env.THINT_ORDER_FILE = path.join(root, "order.json");
  process.env.THINT_HISTORY_FILE = path.join(root, "history.jsonl");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "x", scripts: { lint: "next lint", build: "next build", dev: "next dev" } }));
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
beforeEach(() => {
  resetHistory();
  reloadOrder();
  resetOrder();
});

const names = async (cmd: string) => (await getSuggestions(cmd, root, Shell.Zsh))?.suggestions.map((s) => s.name) ?? [];

test("the order you set comes first, after the words it was set for", async () => {
  expect((await names("pnpm "))[0]).not.toBe("install");
  reorderSuggestions("pnpm ", Shell.Zsh, ["install", "dev"]);
  expect((await names("pnpm ")).slice(0, 2)).toEqual(["install", "dev"]);
  expect(orderRank("pnpm", "install")).toBe(0);
  expect(listOrders()).toEqual({ pnpm: ["install", "dev"] });
});

test("typed text still filters first: your order only sorts the matches", async () => {
  reorderSuggestions("pnpm ", Shell.Zsh, ["lint", "install"]);
  const found = await names("pnpm i");
  expect(found[0]).toBe("install"); // `i` is install's short name, an exact match
  expect(found.indexOf("lint")).toBeGreaterThan(found.indexOf("init"));
});

test("the order survives a restart and can be forgotten", async () => {
  reorderSuggestions("git checkout ", Shell.Zsh, ["main"]);
  reloadOrder();
  expect(orderRank("git checkout", "main")).toBe(0);
  expect(resetOrder("git checkout")).toBe(1);
  expect(orderRank("git checkout", "main")).toBeUndefined();
});

test("what you use often beats the priority the spec gives", async () => {
  for (let i = 0; i < 3; i++) recordCommand(parseCommand("pnpm install ", Shell.Zsh), root);
  expect((await names("pnpm "))[0]).toBe("install");
});

test("a short name you typed counts as using the full name", async () => {
  for (let i = 0; i < 3; i++) recordCommand(parseCommand("pnpm i ", Shell.Zsh), root);
  expect((await names("pnpm "))[0]).toBe("install");
});
