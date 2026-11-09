// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { turboTasks, workspacePackages } from "../../runtime/project.js";
import { getSuggestions } from "../../runtime/runtime.js";
import { unpackResources } from "../../utils/node.js";
import { Shell } from "../../utils/shell.js";

let root: string;
const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text);
};

beforeAll(async () => {
  await unpackResources();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "thint-project-"));
  write("mono/pnpm-workspace.yaml", 'packages:\n  - "apps/*"\n  - "packages/*"\n');
  write("mono/package.json", '{ "name": "mono", "scripts": { "dev": "turbo run dev" } }');
  write("mono/apps/web/package.json", '{ "name": "@acme/web" }');
  write("mono/packages/ui/package.json", '{ "name": "@acme/ui" }');
  write(
    "mono/turbo.json",
    '{\n  // turbo 2\n  "tasks": { "build": { "dependsOn": ["^build"] }, "dev": { "cache": false, "persistent": true }, "web#test": {} }\n}',
  );
  write("npmws/package.json", '{ "name": "npmws", "workspaces": ["libs/*"] }');
  write("npmws/libs/core/package.json", '{ "name": "core" }');
  write("old-turbo/turbo.json", '{ "pipeline": { "build": {} } }');
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

test("finds pnpm workspace packages from any folder inside the repo", async () => {
  const packages = await workspacePackages(path.join(root, "mono", "apps", "web"));
  expect(packages.map((p) => p.name)).toEqual(["@acme/ui", "@acme/web"]);
});

test("finds npm and yarn workspaces declared in package.json", async () => {
  expect((await workspacePackages(path.join(root, "npmws", "libs", "core"))).map((p) => p.name)).toEqual(["core"]);
});

test("reads turbo 2 tasks (with comments) and turbo 1 pipelines", async () => {
  const tasks = await turboTasks(path.join(root, "mono"));
  expect(tasks.map((t) => t.name)).toEqual(["build", "dev", "test"]);
  expect(tasks.find((t) => t.name === "dev")?.description).toContain("long-running");
  expect((await turboTasks(path.join(root, "old-turbo"))).map((t) => t.name)).toEqual(["build"]);
});

test("pnpm --filter suggests workspace packages, scoped names included", async () => {
  const names = async (cmd: string) => (await getSuggestions(cmd, path.join(root, "mono"), Shell.Zsh))?.suggestions.map((s) => s.name) ?? [];
  expect(await names("pnpm --filter ")).toEqual(expect.arrayContaining(["@acme/web", "@acme/ui"]));
  expect(await names("pnpm -F @acme/w")).toEqual(["@acme/web"]);
});

test("turbo run suggests tasks, also after a --filter in the middle", async () => {
  const names = async (cmd: string) => (await getSuggestions(cmd, path.join(root, "mono"), Shell.Zsh))?.suggestions.map((s) => s.name) ?? [];
  expect(await names("turbo run ")).toEqual(expect.arrayContaining(["build", "dev", "test"]));
  expect(await names("turbo run build --filter @acme/u")).toEqual(["@acme/ui"]);
});

test("git branches show the age and subject of their last commit", async () => {
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo);
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: repo });
  git("init", "-q", "-b", "main");
  git("commit", "-q", "--allow-empty", "-m", "first");
  git("checkout", "-q", "-b", "feature/login");
  git("commit", "-q", "--allow-empty", "-m", "add login form");
  git("checkout", "-q", "main");
  const suggestions = (await getSuggestions("git checkout feat", repo, Shell.Zsh))?.suggestions ?? [];
  expect(suggestions.find((s) => s.name === "feature/login")?.description).toMatch(/ago · add login form$/);
});
