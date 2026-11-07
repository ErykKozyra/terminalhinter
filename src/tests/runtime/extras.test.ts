// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { findFixes } from "../../runtime/extras/fixes.js";
import { riskOfEntry, riskOfLine, riskOfValue } from "../../runtime/extras/risk.js";
import { composeServices, makeTargets } from "../../runtime/extras/tasks.js";
import { splitSpec, versionSuggestions } from "../../runtime/extras/versions.js";
import { fillSnippet, previewSnippet, snippetFields } from "../../runtime/extras/snippets.js";
import { withoutTheirLines } from "../../utils/migrate.js";
import { rankCommands } from "../../runtime/extras/recent.js";
import { augmentGit } from "../../runtime/extras/git.js";
import { closest, looksSecret } from "../../runtime/extras/util.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thint-extras-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const noBranches = async () => [];

describe("fixes", () => {
  test("a mistyped command", async () => {
    const fixes = await findFixes({ command: "gti status", exitCode: 127, output: "zsh: command not found: gti", cwd: dir }, () => ["git", "gh"], noBranches);
    expect(fixes[0].command).toBe("git status");
  });
  test("git push without an upstream takes the command git prints", async () => {
    const output =
      "fatal: The current branch fix/login has no upstream branch.\nTo push the current branch and set the remote as upstream, use\n\n    git push --set-upstream origin fix/login\n";
    const fixes = await findFixes({ command: "git push", exitCode: 128, output, cwd: dir }, () => [], noBranches);
    expect(fixes.map((f) => f.command)).toContain("git push --set-upstream origin fix/login");
  });
  test("git's own most similar command", async () => {
    const output = "git: 'stauts' is not a git command. See 'git --help'.\n\nThe most similar command is\n\tstatus";
    const fixes = await findFixes({ command: "git stauts", exitCode: 1, output, cwd: dir }, () => [], noBranches);
    expect(fixes[0].command).toBe("git status");
  });
  test("a branch with a near name", async () => {
    const output = "error: pathspec 'mian' did not match any file(s) known to git";
    const fixes = await findFixes(
      { command: "git checkout mian", exitCode: 1, output, cwd: dir },
      () => [],
      async () => ["main", "dev"],
    );
    expect(fixes[0].command).toBe("git checkout main");
  });
  test("a missing npm script", async () => {
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: { build: "tsc", dev: "vite" } }));
    const fixes = await findFixes({ command: "npm run biuld", exitCode: 1, output: 'npm error Missing script: "biuld"', cwd: dir }, () => [], noBranches);
    expect(fixes[0].command).toBe("npm run build");
  });
  test("mkdir -p and rm -r", async () => {
    expect(
      (await findFixes({ command: "mkdir a/b", exitCode: 1, output: "mkdir: a: No such file or directory", cwd: dir }, () => [], noBranches))[0].command,
    ).toBe("mkdir -p a/b");
    expect((await findFixes({ command: "rm dist", exitCode: 1, output: "rm: dist: is a directory", cwd: dir }, () => [], noBranches))[0].command).toBe(
      "rm -r dist",
    );
  });
  test("nothing for success or Ctrl+C", async () => {
    expect(await findFixes({ command: "gti", exitCode: 0, output: "", cwd: dir }, () => ["git"], noBranches)).toEqual([]);
    expect(await findFixes({ command: "gti", exitCode: 130, output: "", cwd: dir }, () => ["git"], noBranches)).toEqual([]);
  });
  test("typos", () => {
    expect(closest("gti", ["git", "gh", "go", "gt"])).toBe("git");
    expect(closest("dokcer", ["docker", "dotnet"])).toBe("docker");
    expect(closest("xyz", ["git"])).toBeUndefined();
  });
});

describe("risk", () => {
  test("options and subcommands", () => {
    expect(riskOfEntry(["git", "push"], "--force")).toMatch(/overwrites/);
    expect(riskOfEntry(["git", "push", "origin", "main"], "-f")).toMatch(/overwrites/);
    expect(riskOfEntry(["git", "reset"], "--hard")).toMatch(/uncommitted/);
    expect(riskOfEntry(["git", "push"], "--tags")).toBeUndefined();
    expect(riskOfEntry(["rm"], "-rf")).toBeDefined();
    expect(riskOfEntry(["kubectl"], "delete")).toBeDefined();
  });
  test("values that look like production", () => {
    expect(riskOfValue("deploy:prod")).toBeDefined();
    expect(riskOfValue("PROD")).toBeDefined();
    expect(riskOfValue("prod-db-1")).toBeDefined();
    expect(riskOfValue("product-page")).toBeUndefined();
    expect(riskOfValue("main")).toBeUndefined();
    expect(riskOfValue("CI")).toBeUndefined();
  });
  test("whole lines", () => {
    expect(riskOfLine(["rm", "-rf", "/"])).toHaveLength(1);
    expect(riskOfLine(["git", "push", "--force", "origin", "main"])).toHaveLength(1);
    expect(riskOfLine(["ls", "-la"])).toHaveLength(0);
  });
});

describe("project tasks", () => {
  test("Makefile targets with descriptions, sections and tags", () => {
    fs.writeFileSync(
      path.join(dir, "Makefile"),
      ".PHONY: dev\n##@ Development\ndev: ## Start with hot reload\n\techo dev\nbuild test: deps\n\techo\ndeploy: ## [prod] Ship it\nVAR := 1\n%.o: %.c\n",
    );
    const targets = makeTargets(dir);
    expect(targets.map((t) => t.name)).toEqual(["dev", "build", "test", "deploy"]);
    expect(targets[0].description).toBe("Development · Start with hot reload");
    expect(targets[3].risk).toMatch(/prod/);
  });
  test("docker compose services", () => {
    fs.writeFileSync(path.join(dir, "compose.yaml"), "services:\n  web:\n    build: .\n  db:\n    image: postgres:16\n");
    expect(composeServices(dir).map((s) => [s.name, s.description])).toEqual([
      ["web", "service · built here"],
      ["db", "service · postgres:16"],
    ]);
  });
});

describe("package versions", () => {
  test("only when a version is being typed", () => {
    expect(splitSpec("react@18")).toEqual(["react", "18"]);
    expect(splitSpec("@types/node@")).toEqual(["@types/node", ""]);
    expect(splitSpec("@types/node")).toBeUndefined();
    expect(splitSpec("react")).toBeUndefined();
  });
  test("tags first, newest versions next", () => {
    const list = versionSuggestions("react", {
      "dist-tags": { latest: "19.0.0", next: "19.1.0-rc.1" },
      versions: { "18.3.1": {}, "19.0.0": {}, "19.1.0-rc.1": {}, "18.2.0": { deprecated: "x" } },
    });
    expect(list.map((s) => s.name)).toEqual(["latest", "next", "19.0.0", "18.3.1", "18.2.0", "19.1.0-rc.1"]);
    expect(list[0].insertValue).toBe("react@latest ");
    expect(list.find((s) => s.name === "18.2.0")?.description).toBe("deprecated");
  });
});

describe("snippets", () => {
  test("fields, defaults and filling", () => {
    const command = "kill $(lsof -ti :{{port:3000}}) && echo {{port}} {{note}}";
    expect(snippetFields(command)).toEqual([{ name: "port", default: "3000" }, { name: "note" }]);
    expect(fillSnippet(command, { note: "done" })).toBe("kill $(lsof -ti :3000) && echo 3000 done");
    expect(previewSnippet(command)).toBe("kill $(lsof -ti :<port>) && echo <port> <note>");
  });
});

describe("migrate", () => {
  test("takes out Kiro, Q and Fig lines and keeps the rest", () => {
    const zshrc = [
      "# Kiro CLI pre block. Keep at the top of this file.",
      '[[ -f "${HOME}/Library/Application Support/kiro-cli/shell/zshrc.pre.zsh" ]] && builtin source "${HOME}/Library/Application Support/kiro-cli/shell/zshrc.pre.zsh"',
      "export PATH=$HOME/bin:$PATH",
      "# Fig post block. Keep at the bottom of this file.",
      '[[ -f "$HOME/.fig/shell/zshrc.post.zsh" ]] && builtin source "$HOME/.fig/shell/zshrc.post.zsh"',
      'eval "$(q init zsh post)"',
      "alias gs='git status'",
    ].join("\n");
    const { text, removed } = withoutTheirLines(zshrc);
    expect(removed).toHaveLength(5);
    expect(text).toBe("export PATH=$HOME/bin:$PATH\nalias gs='git status'");
  });
});

describe("history and secrets", () => {
  test("whole commands ran here, most used first", () => {
    const now = Date.now();
    const list = [
      { command: "pnpm --filter web dev", cwd: "/p", time: now - 1000 },
      { command: "pnpm --filter web dev", cwd: "/p", time: now - 2000 },
      { command: "pnpm build", cwd: "/p", time: now - 500 },
      { command: "pnpm test", cwd: "/other", time: now },
    ];
    expect(rankCommands(list, "/p", "pn", now).map((r) => r.command)).toEqual(["pnpm --filter web dev", "pnpm build"]);
  });
  test("secret-looking lines", () => {
    expect(looksSecret("curl -H token --token abc123")).toBe(true);
    expect(looksSecret("GITHUB_TOKEN=ghp_abcdefghijklmnop12345 gh pr list")).toBe(true);
    expect(looksSecret("git commit -m 'fix login'")).toBe(false);
  });
});

describe("git aliases", () => {
  test("an alias completes like the command it stands for", () => {
    const checkout = { name: "checkout", description: "Switch branches", args: { name: "branch" } };
    type N = { name: string; description?: string; args?: Fig.Arg; subcommands?: N[] };
    const root: N = { name: "git", subcommands: [checkout, { name: "stash", subcommands: [{ name: "pop" }] }] };
    augmentGit(root, [
      { name: "co", expansion: "checkout" },
      { name: "lg", expansion: "!git log --oneline" },
    ]);
    const co = root.subcommands?.find((s) => s.name === "co") as N;
    expect(co.args).toEqual({ name: "branch" });
    expect(co.description).toBe("alias: checkout");
    expect(root.subcommands?.find((s) => s.name === "lg")?.description).toBe("alias: !git log --oneline");
    const pop = root.subcommands?.[1].subcommands?.[0] as { args?: { generators?: unknown[] } };
    expect(pop.args?.generators).toHaveLength(1);
  });
});
