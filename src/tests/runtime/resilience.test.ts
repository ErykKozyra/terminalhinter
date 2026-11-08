// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// Whatever goes wrong around it (a broken file, a full disk, no home folder, a generator that hangs or throws),
// the list keeps working for everything else, and nothing thint does throws into the session.

import { jest } from "@jest/globals";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";

import { getSuggestions, loadLocalSpecsSet, recordExecutedCommand, rememberWholeCommand } from "../../runtime/runtime.js";
import { rememberCommand, resetRecent } from "../../runtime/extras/recent.js";
import { loadCustomSpecs } from "../../runtime/customSpecs.js";
import { loadSnippets } from "../../runtime/extras/snippets.js";
import { overrideConfig, getConfig } from "../../utils/config.js";
import { allResourcesPath, specResourcesPath } from "../../utils/constants.js";
import { Shell } from "../../utils/shell.js";

const unix = os.platform() !== "win32";
const repo = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..", "..", "..");
const names = async (cmd: string) => ((await getSuggestions(cmd, process.cwd(), Shell.Bash))?.suggestions ?? []).map((s) => s.name);

let dir: string;
const marker = `${Math.floor(Math.random() * 900 + 100)}.${Math.floor(Math.random() * 90 + 10)}`;
const originalSpecs = getConfig().specs;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "thint-resilience-"));
  const specs = path.join(dir, "specs");
  fs.mkdirSync(specs);
  fs.writeFileSync(
    path.join(specs, "hang.yaml"),
    [
      "name: hang",
      "subcommands:",
      "  - name: slow",
      `    args: { name: thing, script: "sleep ${marker}; echo late" }`,
      "  - name: cancel",
      `    args: { name: thing, script: "sleep ${marker}; echo late" }`,
      "  - name: pipe",
      `    args: { name: thing, script: "sleep ${marker} | cat" }`,
      "  - name: fails",
      '    args: { name: thing, script: "echo nope >&2; exit 3" }',
      "  - name: ok",
      "    args: { name: thing, suggestions: [alpha, beta] }",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(path.join(specs, "broken.yaml"), "name: broken\nsubcommands: [ {name: a\n  - : :\n");
  fs.writeFileSync(path.join(specs, "empty.yaml"), "");
  fs.writeFileSync(
    path.join(specs, "serve.yaml"),
    [
      "name: serve",
      "subcommands:",
      "  - name: 2024",
      "options:",
      "  - name: [--port, ~]",
      "    args: { name: port, suggestions: [3000, 8080, ~, true, {name: 443, description: https}] }",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(path.join(specs, "notaspec.json"), "[1, 2, 3]");
  // a JavaScript spec whose generator throws
  const js = path.join(dir, "js");
  fs.mkdirSync(js);
  fs.writeFileSync(path.join(js, "package.json"), '{ "type": "module" }\n');
  fs.writeFileSync(path.join(js, "index.js"), 'export default ["boomjs"];\n'); // no diffVersionedCompletions, like a hand-made folder
  fs.writeFileSync(
    path.join(js, "boomjs.js"),
    'export default { name: "boomjs", subcommands: [{ name: "go", args: { name: "x", generators: { custom: async () => { throw new Error("generator broke"); } } } }, { name: "fine" }] };\n',
  );
  process.env.THINT_SPECS_DIR = specs;
  process.env.THINT_SNIPPETS_FILE = path.join(dir, "snippets.yaml");
  fs.writeFileSync(process.env.THINT_SNIPPETS_FILE, "- name: [unclosed\n  command: : :\n");
  process.env.THINT_COMMANDS_FILE = path.join(dir, "commands.jsonl");
  process.env.THINT_HISTORY_FILE = path.join(dir, "history.jsonl");
  process.env.THINT_NO_ATUIN = "1";
  overrideConfig({ specs: { path: [js] } });
  await loadLocalSpecsSet();
});

afterAll(() => {
  overrideConfig({ specs: originalSpecs });
  for (const name of ["THINT_SPECS_DIR", "THINT_SNIPPETS_FILE", "THINT_COMMANDS_FILE", "THINT_HISTORY_FILE", "THINT_NO_ATUIN"]) delete process.env[name];
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("broken files", () => {
  test("a broken YAML spec is reported and skipped, the good one in the same folder works", async () => {
    const { errors } = loadCustomSpecs();
    expect(errors.map((e) => path.basename(e.file))).toEqual(expect.arrayContaining(["broken.yaml"]));
    expect(await names("hang ok ")).toEqual(["alpha", "beta"]);
  });

  test("the built-in specs still work next to broken ones", async () => {
    expect(await names("git ")).toContain("checkout");
  });

  test("a broken spec gives no list for its own command and does not throw", async () => {
    await expect(names("broken ")).resolves.toBeDefined();
    await expect(names("empty ")).resolves.toBeDefined();
  });

  test("numbers and empty entries in a YAML spec are read as text or left out", async () => {
    expect(await names("serve ")).toEqual(expect.arrayContaining(["2024", "--port"]));
    expect(await names("serve --port ")).toEqual(["3000", "8080", "true", "443"]);
  });

  test("a broken snippets file is reported, and the list for everything else works", async () => {
    expect(loadSnippets().error).toBeTruthy();
    expect(await names("git ")).toContain("checkout");
    await expect(names("rel")).resolves.toBeDefined();
  });
});

describe("generators", () => {
  test.each(["slow", "pipe"])(
    "one that hangs (%s) gives up at its time limit and leaves nothing running",
    async (sub) => {
      const started = Date.now();
      await names(`hang ${sub} `);
      expect(Date.now() - started).toBeLessThan(7000);
      if (unix) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        const left = execFileSync("ps", ["-eo", "args"], { encoding: "utf8" })
          .split("\n")
          .filter((line) => line.includes(`sleep ${marker}`) && !line.includes("ps -eo"));
        expect(left).toEqual([]);
      }
    },
    15_000,
  );

  test("one that is cancelled by the next key stops at once", async () => {
    const controller = new AbortController();
    const started = Date.now();
    const pending = getSuggestions("hang cancel ", process.cwd(), Shell.Bash, controller.signal).catch(() => undefined);
    setTimeout(() => controller.abort(), 200);
    await pending;
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test("one whose script fails gives an empty list", async () => {
    expect(await names("hang fails ")).toEqual([]);
  });

  test("one that throws does not break its command's other entries or other commands", async () => {
    await expect(names("boomjs go ")).resolves.toBeDefined();
    expect(await names("boomjs ")).toContain("fine");
    expect(await names("git ")).toContain("checkout");
  });
});

describe("a disk that refuses writes", () => {
  const enospc = () => Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });

  test("remembering commands with a full disk does not throw", async () => {
    resetRecent();
    const sync = [jest.spyOn(fs, "appendFileSync"), jest.spyOn(fs, "writeFileSync"), jest.spyOn(fs, "mkdirSync")].map((spy) =>
      spy.mockImplementation(() => {
        throw enospc();
      }),
    );
    const asyncWrite = jest.spyOn(fs.promises, "appendFile").mockRejectedValue(enospc());
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    try {
      for (let i = 0; i < 20; i++) {
        expect(() => rememberCommand(`git checkout feature/${i}`, "/work")).not.toThrow();
        expect(() => rememberWholeCommand(`npm run task-${i}`, "/work")).not.toThrow();
        expect(() => recordExecutedCommand(`git switch feature/${i}`, "/work", Shell.Zsh)).not.toThrow();
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(unhandled).toEqual([]);
      expect(await names("git ")).toContain("checkout");
    } finally {
      process.off("unhandledRejection", onUnhandled);
      for (const spy of sync) spy.mockRestore();
      asyncWrite.mockRestore();
    }
  });
});

// a fresh process with HOME missing, pointing nowhere or at a folder nobody can write; the unpacked specs stay where
// they are (thint itself starts the shell without the list when it cannot unpack them, see startupFallback.test.ts)
const unpacked = fs.existsSync(path.join(specResourcesPath, "git.js"));
describe("the home folder", () => {
  const script = [
    'const { getSuggestions } = await import("./src/runtime/runtime.ts");',
    'const { rememberCommand } = await import("./src/runtime/extras/recent.ts");',
    'const { loadConfig } = await import("./src/utils/config.ts");',
    "await loadConfig();",
    'rememberCommand("git checkout main", process.cwd());',
    'const blob = await getSuggestions("git ", process.cwd(), "bash");',
    'console.log(blob.suggestions.some((s) => s.name === "checkout") ? "OK" : "NO LIST");',
  ].join("\n");
  const runWith = (env: NodeJS.ProcessEnv) =>
    spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { cwd: repo, env, encoding: "utf8", timeout: 60_000 });

  const base = () => {
    const env = { ...process.env };
    for (const key of ["THINT_SPECS_DIR", "THINT_SNIPPETS_FILE", "THINT_COMMANDS_FILE", "THINT_HISTORY_FILE", "XDG_CONFIG_HOME"]) delete env[key];
    env.XDG_DATA_HOME = path.dirname(allResourcesPath);
    return env;
  };

  test.each([
    [
      "missing",
      () => {
        const env = base();
        delete env.HOME;
        delete env.USERPROFILE;
        return env;
      },
    ],
    ["pointing at a folder that does not exist", () => ({ ...base(), HOME: path.join(dir, "no-such-home") })],
    [
      "a file instead of a folder",
      () => {
        const file = path.join(dir, "home-is-a-file");
        fs.writeFileSync(file, "");
        return { ...base(), HOME: file };
      },
    ],
    [
      "read only",
      () => {
        const home = path.join(dir, "readonly-home");
        fs.mkdirSync(home, { recursive: true });
        fs.chmodSync(home, 0o500);
        return { ...base(), HOME: home };
      },
    ],
  ])(
    "HOME %s: the list still works",
    (_label, env) => {
      if (!unix || !unpacked) return;
      const result = runWith(env());
      expect(result.stderr).not.toMatch(/Error|at .+:\d+:\d+/);
      expect(result.stdout.trim()).toBe("OK");
    },
    70_000,
  );
});
