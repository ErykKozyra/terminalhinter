// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import path from "node:path";

import { describeRecent, rankCommands } from "../../runtime/extras/recent.js";

const now = Date.UTC(2026, 10, 8, 12);
const root = path.join(path.sep, "work", "shop");
const src = path.join(root, "src");
const other = path.join(path.sep, "work", "blog");
const at = (minutesAgo: number) => now - minutesAgo * 60_000;

const list = [
  { command: "npm run dev", cwd: root, time: at(5) },
  { command: "npm run dev", cwd: root, time: at(50) },
  { command: "npm test", cwd: src, time: at(10) },
  { command: "npm run build", cwd: other, time: at(1) },
  { command: "npm run lint", cwd: path.join(root, "src", "components"), time: at(2) },
  { command: "npm publish", cwd: path.join(path.sep, "work", "shop-old"), time: at(1) },
];

test("in the folder where it ran, it counts fully and says ran here", () => {
  const ranked = rankCommands(list, src, "npm", now, root);
  expect(ranked[0].command).toBe("npm test");
  expect(describeRecent(ranked[0], now)).toMatch(/^ran here/);
});

test("elsewhere in the same repository it comes back and says so", () => {
  const ranked = rankCommands(list, src, "npm", now, root);
  const dev = ranked.find((r) => r.command === "npm run dev");
  expect(dev).toBeDefined();
  expect(describeRecent(dev!, now)).toMatch(/^ran in this repo 2×/);
  expect(ranked.some((r) => r.command === "npm run lint")).toBe(true);
});

test("another repository and a folder that only shares the name prefix stay out", () => {
  const names = rankCommands(list, src, "npm", now, root).map((r) => r.command);
  expect(names).not.toContain("npm run build");
  expect(names).not.toContain("npm publish");
});

test("outside a repository only this folder counts", () => {
  const names = rankCommands(list, src, "npm", now).map((r) => r.command);
  expect(names).toEqual(["npm test"]);
});

test("a run here outweighs the same age elsewhere in the repo", () => {
  const ranked = rankCommands(
    [
      { command: "make a", cwd: root, time: at(1) },
      { command: "make b", cwd: src, time: at(1) },
    ],
    src,
    "make",
    now,
    root,
  );
  expect(ranked.map((r) => r.command)).toEqual(["make b", "make a"]);
});
