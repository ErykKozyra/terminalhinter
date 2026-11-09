// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadCustomSpecs, parseCustomSpec } from "../../runtime/customSpecs.js";
import { getSuggestions, loadLocalSpecsSet } from "../../runtime/runtime.js";
import { unpackResources } from "../../utils/node.js";
import { Shell } from "../../utils/shell.js";

let dir: string;
beforeAll(async () => {
  await unpackResources();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "thint-specs-"));
  process.env.THINT_SPECS_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "deploy.yaml"),
    `name: deploy
description: Deploy our apps
subcommands:
  - name: staging
    description: Deploy to staging
    args:
      name: app
      suggestions: [web, admin]
  - name: logs
    args:
      name: service
      script: "printf 'api\\tthe backend\\nworker\\n'"
options:
  - name: [--force, -f]
    description: Skip the checks
`,
  );
  fs.writeFileSync(path.join(dir, "broken.yaml"), "name: [unclosed\n");
  await loadLocalSpecsSet();
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

const names = async (cmd: string) => (await getSuggestions(cmd, dir, Shell.Zsh))?.suggestions.map((s) => s.name) ?? [];

test("a YAML file becomes a command with subcommands, options and argument values", async () => {
  expect(await names("deploy ")).toEqual(expect.arrayContaining(["staging", "logs", "--force"]));
  expect(await names("deploy staging ")).toEqual(["web", "admin"]);
});

test("script output becomes suggestions, a tab separates the description", async () => {
  const suggestions = (await getSuggestions("deploy logs ", dir, Shell.Zsh))?.suggestions ?? [];
  expect(suggestions.map((s) => [s.name, s.description])).toEqual([
    ["api", "the backend"],
    ["worker", undefined],
  ]);
});

test("the command name is offered at the start of the line", async () => {
  expect(await names("depl")).toContain("deploy");
});

test("a broken file is reported and skipped", () => {
  const { specs, errors } = loadCustomSpecs();
  expect([...specs.keys()]).toEqual(["deploy"]);
  expect(errors.map((e) => path.basename(e.file))).toEqual(["broken.yaml"]);
});

test("every node needs a name", () => {
  expect(() => parseCustomSpec("description: nameless", "x.yaml")).toThrow(/needs a name/);
});
