// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  composeFallback,
  composeGenerator,
  composeServices,
  denoTasks,
  justRecipes,
  makeTargets,
  miseTasks,
  taskfileTasks,
} from "../../runtime/extras/tasks.js";

// no just, task or mise binaries: the files are read directly, the same on every machine
const realPath = process.env.PATH;
beforeAll(() => (process.env.PATH = ""));
afterAll(() => (process.env.PATH = realPath));

const root = fs.mkdtempSync(path.join(os.tmpdir(), "thint-tasks-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
let n = 0;
const project = (files: Record<string, string>): string => {
  const dir = path.join(root, `p${n++}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
};

type Expect = Record<string, string | undefined | { description?: string; risk?: boolean }>;
const check = (tasks: { name?: unknown; description?: string; risk?: string }[], expected: Expect, exact = true) => {
  const got = new Map(tasks.map((t) => [String(t.name), t]));
  if (exact) expect([...got.keys()].sort()).toEqual(Object.keys(expected).sort());
  for (const [name, want] of Object.entries(expected)) {
    const task = got.get(name);
    expect(task).toBeDefined();
    if (typeof want === "object" && want != null) {
      if ("description" in want) expect(task?.description).toBe(want.description);
      if (want.risk != null) expect(task?.risk != null).toBe(want.risk);
    } else expect(task?.description).toBe(want);
  }
};

const makefiles: [string, string, Expect][] = [
  ["plain targets", "build:\n\tgo build\ntest:\n\tgo test ./...\n", { build: undefined, test: undefined }],
  ["## descriptions", "build: ## Build the app\n\tgo build\ntest: deps ## Run the tests\n\tgo test\n", { build: "Build the app", test: "Run the tests" }],
  [
    "##@ sections",
    "##@ Development\ndev: ## Start the dev server\n\tx\n##@ Release\nrelease: ## Tag and push\n\tx\n",
    { dev: "Development · Start the dev server", release: "Release · Tag and push" },
  ],
  ["a section without descriptions", "##@ Build\nall:\n\tx\n", { all: "Build" }],
  [".PHONY is skipped", ".PHONY: build test\nbuild:\n\tx\ntest:\n\tx\n", { build: undefined, test: undefined }],
  ["pattern rules are skipped", "%.o: %.c\n\tcc -c $<\napp: main.o\n\tcc -o app main.o\n", { app: undefined }],
  ["variables are not targets", "CC := gcc\nCFLAGS = -O2\nPREFIX ?= /usr/local\nLDFLAGS += -lm\nall:\n\tx\n", { all: undefined }],
  ["target-specific variables are skipped", "release: CFLAGS += -O3\nrelease: ## Optimized build\n\tx\n", { release: "Optimized build" }],
  ["double colon", "clean:: ## Remove build files\n\trm -rf build\nclean::\n\trm -rf dist\n", { clean: "Remove build files" }],
  ["several targets on one line", "lint fmt: ## Code style\n\tx\n", { lint: "Code style", fmt: "Code style" }],
  ["CRLF", "build: ## Build it\r\n\tx\r\ntest: ## Test it\r\n\tx\r\n", { build: "Build it", test: "Test it" }],
  ["define blocks are skipped", "define HELP\nfake: not a target\nendef\nreal:\n\tx\n", { real: undefined }],
  ["recipes indented with tabs are not targets", "build:\n\techo a: b\n\tcd x && make y:z\n", { build: undefined }],
  ["dots and slashes in names", "docs/build: ## Build docs\n\tx\nv1.2: ## Old\n\tx\n", { "docs/build": "Build docs", "v1.2": "Old" }],
  ["names with dashes and underscores", "db-migrate: ## Migrate\n\tx\nrun_tests:\n\tx\n", { "db-migrate": "Migrate", run_tests: undefined }],
  ["[prod] tag", "deploy: ## [prod] Deploy to production\n\tx\n", { deploy: { description: "Deploy to production", risk: true } }],
  ["[danger] tag", "wipe: ## [danger] Delete the database\n\tx\n", { wipe: { description: "Delete the database", risk: true } }],
  ["no tag, no risk", "deploy-staging: ## Deploy staging\n\tx\n", { "deploy-staging": { description: "Deploy staging", risk: false } }],
  ["a later description fills an earlier target", "build: deps\nbuild: ## Build it\n\tx\n", { build: "Build it" }],
  ["the first description wins", "build: ## First\nbuild: ## Second\n", { build: "First" }],
  ["include lines are not targets", "include common.mk\n-include .env\nall:\n\tx\n", { all: undefined }],
  ["comments are not targets", "# build: not this\n#test:\nall:\n\tx\n", { all: undefined }],
  ["export lines are not targets", "export PATH := ./bin:$(PATH)\nall:\n\tx\n", { all: undefined }],
  ["an empty Makefile", "", {}],
  ["only variables", "A = 1\nB := 2\n", {}],
  ["a description with ## in it", "build: ## Build ## twice\n\tx\n", { build: "Build ## twice" }],
  ["spaces around the colon", "build : ## Spaced\n\tx\n", { build: "Spaced" }],
  ["a target with an order-only prerequisite", "out: | dir ## Make out\n\tx\n", { out: "Make out" }],
];

describe("Makefile targets", () => {
  test.each(makefiles)("%s", (_name, text, expected) => {
    check(makeTargets(project({ Makefile: text })), expected);
  });
  test.each([["GNUmakefile"], ["makefile"], ["Makefile"]])("found as %s", (file) => {
    check(makeTargets(project({ [file]: "x: ## from this file\n" })), { x: "from this file" });
  });
  test("GNUmakefile wins over Makefile, like make", () => {
    check(makeTargets(project({ GNUmakefile: "g:\n", Makefile: "m:\n" })), { g: undefined });
  });
  test("an explicit file", () => {
    const dir = project({ "build.mk": "only: ## In build.mk\n", Makefile: "other:\n" });
    check(makeTargets(dir, path.join(dir, "build.mk")), { only: "In build.mk" });
  });
  test("no Makefile", () => expect(makeTargets(project({ "README.md": "x" }))).toEqual([]));
});

const justfiles: [string, string, Expect][] = [
  ["recipes with comments", "# Build the app\nbuild:\n    cargo build\n\n# Run tests\ntest:\n    cargo test\n", { build: "Build the app", test: "Run tests" }],
  ["no comment", "build:\n    x\n", { build: "just recipe" }],
  ["private by underscore", "_helper:\n    x\nbuild:\n    x\n", { build: "just recipe" }],
  ["[private] attribute", "[private]\nhelper:\n    x\nbuild:\n    x\n", { build: "just recipe" }],
  ["doc attribute", '[doc("Deploy it")]\ndeploy:\n    x\n', { deploy: "Deploy it" }],
  ["comment above attributes", "# Lint everything\n[group('ci')]\nlint:\n    x\n", { lint: "Lint everything" }],
  ["parameters", "# Bump\nbump version:\n    x\n", { bump: "Bump" }],
  ["parameters with defaults", "serve port='8080' host=\"0.0.0.0\":\n    x\n", { serve: "just recipe" }],
  ["dependencies", "release: build test\n    x\n", { release: "just recipe" }],
  ["@ quiet recipe", "@quiet:\n    x\n", { quiet: "just recipe" }],
  ["settings and aliases are skipped", 'set shell := ["bash", "-c"]\nalias b := build\nexport FOO := \'1\'\nbuild:\n    x\n', { build: "just recipe" }],
  ["variables are skipped", "version := `git describe`\nbuild:\n    x\n", { build: "just recipe" }],
  ["[prod] in the comment", "# [prod] Ship it\nship:\n    x\n", { ship: { description: "Ship it", risk: true } }],
  ["CRLF", "# Build\r\nbuild:\r\n    x\r\n", { build: "Build" }],
];

describe("just recipes, read from the justfile", () => {
  test.each(justfiles)("%s", async (_name, text, expected) => {
    check(await justRecipes(project({ justfile: text })), expected);
  });
  test.each([["Justfile"], [".justfile"]])("found as %s", async (file) => {
    check(await justRecipes(project({ [file]: "x:\n    y\n" })), { x: "just recipe" });
  });
  test("found in a parent folder", async () => {
    const dir = project({ justfile: "up:\n    x\n", "sub/a.txt": "" });
    check(await justRecipes(path.join(dir, "sub")), { up: "just recipe" });
  });
  test("parameters become the argument", async () => {
    const [bump] = await justRecipes(project({ justfile: "bump version kind='patch':\n    x\n" }));
    expect(bump.args?.name).toBe("version kind='patch'");
  });
});

const taskfiles: [string, Record<string, string>, Expect][] = [
  [
    "desc and summary",
    { "Taskfile.yml": "version: '3'\ntasks:\n  build:\n    desc: Build it\n    cmds: [go build]\n  test:\n    summary: |\n      Run tests\n      and more\n" },
    { build: "Build it", test: "Run tests" },
  ],
  ["no description", { "Taskfile.yml": "version: '3'\ntasks:\n  lint:\n    cmds: [x]\n" }, { lint: "task" }],
  ["internal tasks are hidden", { "Taskfile.yml": "version: '3'\ntasks:\n  a:\n    internal: true\n  b: {}\n" }, { b: "task" }],
  ["a task as a list of commands", { "Taskfile.yml": "version: '3'\ntasks:\n  fmt: [gofmt -w .]\n" }, { fmt: "task" }],
  [
    "includes get a namespace",
    {
      "Taskfile.yml": "version: '3'\nincludes:\n  docs: ./docs\n  db:\n    taskfile: ./db/Tasks.yml\ntasks:\n  build: {}\n",
      "docs/Taskfile.yml": "version: '3'\ntasks:\n  serve:\n    desc: Serve docs\n",
      "db/Tasks.yml": "version: '3'\ntasks:\n  migrate:\n    desc: Migrate\n",
    },
    { build: "task", "docs:serve": "Serve docs", "db:migrate": "Migrate" },
  ],
  [
    "internal includes are hidden",
    {
      "Taskfile.yml": "version: '3'\nincludes:\n  priv:\n    taskfile: ./p.yml\n    internal: true\ntasks:\n  a: {}\n",
      "p.yml": "version: '3'\ntasks:\n  x: {}\n",
    },
    { a: "task" },
  ],
  ["a missing include is skipped", { "Taskfile.yml": "version: '3'\nincludes:\n  gone: ./nope\ntasks:\n  a: {}\n" }, { a: "task" }],
  [
    "[danger] tag",
    { "Taskfile.yml": "version: '3'\ntasks:\n  reset:\n    desc: '[danger] Drop the db'\n" },
    { reset: { description: "Drop the db", risk: true } },
  ],
  ["broken YAML", { "Taskfile.yml": "tasks: [: nope" }, {}],
  ["taskfile.yaml lowercase", { "taskfile.yaml": "version: '3'\ntasks:\n  a: {}\n" }, { a: "task" }],
];

describe("Taskfile tasks, read from the file", () => {
  test.each(taskfiles)("%s", async (_name, files, expected) => {
    check(await taskfileTasks(project(files)), expected);
  });
});

const misefiles: [string, Record<string, string>, Expect][] = [
  ["description", { "mise.toml": '[tasks.build]\ndescription = "Build it"\nrun = "cargo build"\n' }, { build: "Build it" }],
  ["only run", { "mise.toml": '[tasks.test]\nrun = "cargo test"\n' }, { test: "runs cargo test" }],
  ["run as a list", { "mise.toml": '[tasks.ci]\nrun = ["lint", "test"]\n' }, { ci: "runs lint && test" }],
  ["a task as a string", { "mise.toml": '[tasks]\nfmt = "cargo fmt"\n' }, { fmt: "runs cargo fmt" }],
  ["hidden", { "mise.toml": '[tasks.secret]\nhide = true\nrun = "x"\n[tasks.open]\nrun = "y"\n' }, { open: "runs y" }],
  [".mise.toml", { ".mise.toml": '[tasks.a]\nrun = "x"\n' }, { a: "runs x" }],
  ["mise.local.toml adds tasks", { "mise.toml": '[tasks.a]\nrun = "x"\n', "mise.local.toml": '[tasks.b]\nrun = "y"\n' }, { a: "runs x", b: "runs y" }],
  ["a broken file is skipped", { "mise.toml": '[tasks.a]\nrun = "x"\n', "mise.local.toml": "[[[ nope" }, { a: "runs x" }],
  ["[prod] tag", { "mise.toml": '[tasks.deploy]\ndescription = "[prod] Deploy"\nrun = "x"\n' }, { deploy: { description: "Deploy", risk: true } }],
];

describe("mise tasks, read from the file", () => {
  test.each(misefiles)("%s", async (_name, files, expected) => {
    check(await miseTasks(project(files)), expected);
  });
});

const composefiles: [string, string, Expect][] = [
  ["image and build", "services:\n  web:\n    build: .\n  db:\n    image: postgres:16\n", { web: "service · built here", db: "service · postgres:16" }],
  ["neither", "services:\n  worker: {}\n", { worker: "service" }],
  ["a null service", "services:\n  worker:\n", { worker: "service" }],
  ["a production-like name is risky", "services:\n  prod-db:\n    image: x\n", { "prod-db": { risk: true } }],
  ["no services", "version: '3'\n", {}],
  ["broken YAML", "services: [: x", {}],
  ["anchors and extensions", "x-base: &base\n  image: node:22\nservices:\n  api:\n    <<: *base\n", { api: "service · node:22" }],
];

describe("docker compose services", () => {
  test.each(composefiles)("%s", (_name, text, expected) => {
    check(composeServices(project({ "compose.yaml": text })), expected);
  });
  test.each([["compose.yml"], ["docker-compose.yaml"], ["docker-compose.yml"]])("found as %s", (file) => {
    check(composeServices(project({ [file]: "services:\n  a: {}\n" })), { a: "service" });
  });
});

describe("docker is asked for services only when the compose file does not answer", () => {
  const ctx = (dir: string) => ({ currentWorkingDirectory: dir }) as Fig.GeneratorContext;
  const cases: [string, Record<string, string>, string[], boolean][] = [
    ["a compose file here", { "compose.yaml": "services:\n  a: {}\n" }, ["docker", "compose", "up", ""], false],
    ["a compose file in a parent folder", { "x/compose.yaml": "services:\n  a: {}\n" }, ["docker", "compose", "up", ""], false],
    ["no compose file", {}, ["docker", "compose", "up", ""], true],
    ["-f names another file", { "compose.yaml": "services: {}\n" }, ["docker", "compose", "-f", "other.yml", "up", ""], true],
    ["--file=other.yml", { "compose.yaml": "services: {}\n" }, ["docker", "compose", "--file=other.yml", "up", ""], true],
    ["--project-directory", { "compose.yaml": "services: {}\n" }, ["docker", "compose", "--project-directory", "../x", "up", ""], true],
    ["logs -f is --follow, not a file", { "compose.yaml": "services:\n  a: {}\n" }, ["docker", "compose", "logs", "-f", ""], false],
    ["-p names a project", { "compose.yaml": "services: {}\n" }, ["docker", "compose", "-p", "x", "logs", ""], true],
  ];
  test.each(cases)("%s", async (_name, files, tokens, asks) => {
    let dir = project(files);
    if (files["x/compose.yaml"] != null) {
      dir = path.join(dir, "x", "deep");
      fs.mkdirSync(dir, { recursive: true });
    }
    let asked = 0;
    const wrapped = composeFallback({ script: ["docker"] }, async () => {
      asked++;
      return [{ name: "from-docker" }];
    });
    const got = await wrapped.custom!(tokens, (async () => ({ stdout: "", stderr: "", status: 0 })) as Fig.ExecuteCommandFunction, ctx(dir));
    expect(asked).toBe(asks ? 1 : 0);
    expect(got.map((s) => s.name)).toEqual(asks ? ["from-docker"] : []);
  });
  test("our own generator and an already wrapped one stay as they are", () => {
    expect(composeFallback(composeGenerator, async () => [])).toBe(composeGenerator);
    const once = composeFallback({ script: ["docker"] }, async () => []);
    expect(composeFallback(once, async () => [])).toBe(once);
  });
});

const denofiles: [string, Record<string, string>, Expect][] = [
  ["string tasks", { "deno.json": '{"tasks": {"dev": "deno run -A main.ts"}}' }, { dev: "runs deno run -A main.ts" }],
  ["object tasks", { "deno.json": '{"tasks": {"build": {"command": "deno compile", "description": "Compile it"}}}' }, { build: "Compile it" }],
  ["object without description", { "deno.json": '{"tasks": {"build": {"command": "deno compile"}}}' }, { build: "runs deno compile" }],
  [
    "jsonc with comments",
    { "deno.jsonc": '{\n  // dev server\n  "tasks": {\n    /* x */ "dev": "deno run main.ts" // trailing\n  }\n}' },
    { dev: "runs deno run main.ts" },
  ],
  ["a // inside a string stays", { "deno.json": '{"tasks": {"open": "open https://example.com"}}' }, { open: "runs open https://example.com" }],
  ["no tasks", { "deno.json": '{"imports": {}}' }, {}],
  ["broken", { "deno.json": "{ nope" }, {}],
];

describe("deno tasks", () => {
  test.each(denofiles)("%s", (_name, files, expected) => {
    check(denoTasks(project(files)), expected);
  });
});
