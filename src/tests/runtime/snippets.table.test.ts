// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { fillSnippet, loadSnippets, previewSnippet, snippetFields } from "../../runtime/extras/snippets.js";
import { getSuggestions } from "../../runtime/runtime.js";
import { Shell } from "../../utils/shell.js";

const fields: [string, [string, string | undefined][]][] = [
  ["git tag v{{version}}", [["version", undefined]]],
  ["kill $(lsof -ti :{{port:3000}})", [["port", "3000"]]],
  [
    "{{a}} {{b}} {{a}}",
    [
      ["a", undefined],
      ["b", undefined],
    ],
  ],
  ["{{ spaced }}", [["spaced", undefined]]],
  ["{{ port : 8080 }}", [["port", "8080"]]],
  ["{{name:}}", [["name", undefined]]],
  ["{{host:localhost:5432}}", [["host", "localhost:5432"]]],
  [
    "{{dash-name}} {{under_score}}",
    [
      ["dash-name", undefined],
      ["under_score", undefined],
    ],
  ],
  ["{{1bad}} {{ok}}", [["ok", undefined]]],
  ["no fields at all", []],
  ["{single} braces", []],
  [
    "{{a}}{{b}}",
    [
      ["a", undefined],
      ["b", undefined],
    ],
  ],
  ["{{x}} then {{x:later}}", [["x", "later"]]],
  [
    "docker run -p {{port:8080}}:{{inner:80}} {{image}}",
    [
      ["port", "8080"],
      ["inner", "80"],
      ["image", undefined],
    ],
  ],
];

describe("snippet fields", () => {
  test.each(fields)("%s", (command, expected) => {
    expect(snippetFields(command).map((f) => [f.name, f.default])).toEqual(expected);
  });
});

const fills: [string, Record<string, string>, string][] = [
  ["git tag v{{version}} && git push origin v{{version}}", { version: "1.2.0" }, "git tag v1.2.0 && git push origin v1.2.0"],
  ["kill $(lsof -ti :{{port:3000}})", {}, "kill $(lsof -ti :3000)"],
  ["kill $(lsof -ti :{{port:3000}})", { port: "8080" }, "kill $(lsof -ti :8080)"],
  ["kill $(lsof -ti :{{port:3000}})", { port: "" }, "kill $(lsof -ti :3000)"],
  ['git commit -m "wip: {{what}}"', { what: "login page" }, 'git commit -m "wip: login page"'],
  ['git commit -m "wip: {{what}}"', { what: "it's done" }, 'git commit -m "wip: it\'s done"'],
  ["echo {{text}}", { text: "hello world" }, "echo 'hello world'"],
  ["echo {{text}}", { text: "it's" }, "echo 'it'\\''s'"],
  ["echo {{text}}", { text: "$HOME" }, "echo '$HOME'"],
  ["echo {{text}}", { text: "a;rm -rf ~" }, "echo 'a;rm -rf ~'"],
  ["echo {{text}}", { text: "$(whoami)" }, "echo '$(whoami)'"],
  ["echo {{text}}", { text: "`id`" }, "echo '`id`'"],
  ["echo {{text}}", { text: "a|b" }, "echo 'a|b'"],
  ["echo {{text}}", { text: "a&b" }, "echo 'a&b'"],
  ["echo {{text}}", { text: "a>b" }, "echo 'a>b'"],
  ["echo {{text}}", { text: "*.ts" }, "echo '*.ts'"],
  ["cd {{dir}}", { dir: "~/Dev/my-app" }, "cd ~/Dev/my-app"],
  ["cd {{dir}}", { dir: "/tmp/a.b_c-d" }, "cd /tmp/a.b_c-d"],
  ["git checkout {{branch}}", { branch: "feature/x@2" }, "git checkout feature/x@2"],
  ["curl {{url}}", { url: "https://example.com/a?b=1&c=2" }, "curl 'https://example.com/a?b=1&c=2'"],
  ["ssh {{host}}", { host: "me@10.0.0.1" }, "ssh me@10.0.0.1"],
  ["npm i {{pkg}}", { pkg: "@types/node@20" }, "npm i @types/node@20"],
  ["echo '{{text}}'", { text: "inside single" }, "echo 'inside single'"],
  ['echo "{{a}}" {{b}}', { a: "x y", b: "z w" }, "echo \"x y\" 'z w'"],
  ["{{a}} {{a:dflt}}", {}, "dflt dflt"],
  ["{{a:one}} {{a:two}}", {}, "one two"],
  ["echo {{cmd}}", { cmd: "zażółć gęślą" }, "echo 'zażółć gęślą'"],
  ["echo {{x}}", {}, "echo "],
  ["plain", {}, "plain"],
];

describe("filling a snippet", () => {
  test.each(fills)("%s with %j", (command, values, expected) => {
    expect(fillSnippet(command, values)).toBe(expected);
  });
});

const previews: [string, string][] = [
  ["git tag v{{version}}", "git tag v<version>"],
  ["kill $(lsof -ti :{{port:3000}})", "kill $(lsof -ti :<port>)"],
  ["{{a}}-{{b}}", "<a>-<b>"],
  ["nothing", "nothing"],
];

describe("how a snippet reads in the list", () => {
  test.each(previews)("%s", (command, expected) => expect(previewSnippet(command)).toBe(expected));
});

const files: [string, string, string[] | undefined, boolean][] = [
  ["a list", "- name: a\n  command: echo a\n- name: b\n  command: echo b\n", ["a", "b"], false],
  ["under snippets:", "snippets:\n  - name: a\n    command: echo a\n", ["a"], false],
  ["entries without a command are skipped", "- name: a\n- name: b\n  command: x\n", ["b"], false],
  ["entries with a number as name are skipped", "- name: 1\n  command: x\n- name: ok\n  command: y\n", ["ok"], false],
  ["names and commands are trimmed", "- name: '  spaced  '\n  command: '  echo x  '\n", ["spaced"], false],
  ["empty file", "", [], false],
  ["a map, not a list", "a: 1\n", [], false],
  ["broken YAML", "- name: [a\n", [], true],
];

describe("the snippets file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thint-snip-"));
  afterAll(() => {
    delete process.env.THINT_SNIPPETS_FILE;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  test.each(files)("%s", (_name, text, names, error) => {
    const file = path.join(dir, `${Math.random()}.yaml`);
    fs.writeFileSync(file, text);
    process.env.THINT_SNIPPETS_FILE = file;
    const result = loadSnippets();
    expect(result.snippets.map((s) => s.name)).toEqual(names);
    expect(result.error != null).toBe(error);
  });
  test("no file", () => {
    process.env.THINT_SNIPPETS_FILE = path.join(dir, "missing.yaml");
    expect(loadSnippets()).toEqual({ snippets: [] });
  });
  test("a snippet called like a command shows next to the command", async () => {
    const file = path.join(dir, "named-like-git.yaml");
    fs.writeFileSync(
      file,
      "- name: git\n  description: My git routine\n  command: git fetch && git status\n- name: gitlog\n  command: git log --oneline -20\n",
    );
    process.env.THINT_SNIPPETS_FILE = file;
    const blob = await getSuggestions("git", dir, Shell.Bash);
    const named = (blob?.suggestions ?? []).filter((s) => s.name === "git");
    expect(named.map((s) => s.kind ?? "command").sort()).toEqual(["command", "snippet"]);
    // your own snippet first: one Tab starts it, one arrow down reaches the command
    expect(blob?.suggestions[0]).toMatchObject({ name: "git", kind: "snippet" });
    expect((blob?.suggestions ?? []).some((s) => s.name === "gitlog" && s.kind === "snippet")).toBe(true);
  });
});
