// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import { killCommand } from "../../runtime/extras/fixes.js";
import { parseNetstat, parseTasklist } from "../../runtime/extras/processes.js";
import { escapeArgs, msysToWindows } from "../../runtime/utils.js";
import { getGeneratorQueryTerm } from "../../runtime/generator.js";

const netstat = [
  "",
  "Active Connections",
  "",
  "  Proto  Local Address          Foreign Address        State           PID",
  "  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1012",
  "  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       8424",
  "  TCP    127.0.0.1:5432         0.0.0.0:0              LISTENING       3300",
  "  TCP    192.168.1.10:51234     140.82.112.3:443       ESTABLISHED     8424",
  "  TCP    [::]:8080              [::]:0                 LISTENING       912",
  "  TCP    [::1]:9229             [::]:0                 LISTENING       8424",
  "  TCP    0.0.0.0:49664          0.0.0.0:0              LISTENING       0",
  "  UDP    0.0.0.0:5353           *:*                                    2216",
].join("\r\n");

test.each([
  [135, 1012],
  [3000, 8424],
  [5432, 3300],
  [8080, 912],
  [9229, 8424],
])("netstat: port %i is held by pid %i", (port, pid) => {
  expect(parseNetstat(netstat)).toContainEqual({ port, pid });
});

test("netstat: only listening TCP sockets with a real pid", () => {
  const found = parseNetstat(netstat);
  expect(found).toHaveLength(5);
  expect(found.some((l) => l.port === 51234 || l.port === 5353 || l.port === 49664)).toBe(false);
});

test.each(["", "garbage", "  TCP 0.0.0.0:80 LISTENING"])("netstat: nothing from %j", (out) => {
  expect(parseNetstat(out)).toEqual([]);
});

const tasklist = [
  '"System Idle Process","0","Services","0","8 K"',
  '"node.exe","8424","Console","1","92,412 K"',
  '"postgres.exe","3300","Services","0","20,100 K"',
  '"Code - Insiders.exe","912","Console","1","1,000 K"',
].join("\r\n");

test.each([
  [8424, "node"],
  [3300, "postgres"],
  [912, "Code - Insiders"],
])("tasklist: pid %i is %s", (pid, name) => {
  expect(parseTasklist(tasklist).get(pid)).toBe(name);
});

test.each([
  [1234, "cmd", "linux", "taskkill /PID 1234 /F"],
  [1234, "pwsh", "win32", "Stop-Process -Id 1234"],
  [1234, "powershell", "win32", "Stop-Process -Id 1234"],
  [1234, "pwsh", "linux", "Stop-Process -Id 1234"],
  [1234, "bash", "win32", "taskkill //PID 1234 //F"],
  [1234, "bash", "linux", "kill 1234"],
  [1234, "zsh", "darwin", "kill 1234"],
  [1234, "fish", "linux", "kill 1234"],
  [1234, undefined, "linux", "kill 1234"],
] as const)("stopping pid %i in %s on %s: %s", (pid, shell, platform, expected) => {
  expect(killCommand(pid, shell, platform)).toBe(expected);
});

const git = "C:\\Program Files\\Git";
const temp = "C:\\Users\\me\\AppData\\Local\\Temp";
test.each([
  ["/c/Users", "C:\\Users"],
  ["/c/", "C:\\"],
  ["/d/work/shop/", "D:\\work\\shop\\"],
  ["/usr", "C:\\Program Files\\Git\\usr"],
  ["/etc/", "C:\\Program Files\\Git\\etc\\"],
  ["/", "C:\\Program Files\\Git\\"],
  ["/tmp", "C:\\Users\\me\\AppData\\Local\\Temp"],
  ["/tmp/thint-x/", "C:\\Users\\me\\AppData\\Local\\Temp\\thint-x\\"],
  ["/tmpfiles", "C:\\Program Files\\Git\\tmpfiles"],
])("Git Bash: %s is %s", (token, windows) => {
  expect(msysToWindows(token, git, temp)).toBe(windows);
});

test("Git Bash: without a Git folder the path stays as typed", () => {
  expect(msysToWindows("/usr", undefined, temp)).toBe("/usr");
});

describe("the search after a folder typed with a backslash", () => {
  const platform = process.platform;
  beforeAll(() => Object.defineProperty(process, "platform", { value: "win32" }));
  afterAll(() => Object.defineProperty(process, "platform", { value: platform }));
  const bySlash: Fig.Generator = { getQueryTerm: (t: string) => t.slice(t.lastIndexOf("/") + 1) };
  test.each([
    [bySlash, "src\\comp", "comp"],
    [bySlash, "src\\", ""],
    [bySlash, "a\\b/c", "c"],
    [{ getQueryTerm: "/" } as Fig.Generator, "src\\comp", "comp"],
    [{ getQueryTerm: "\\" } as Fig.Generator, "x\\y", "y"],
    [{} as Fig.Generator, "src\\comp", "src\\comp"],
  ])("%#: %s", (generator, token, term) => {
    expect(getGeneratorQueryTerm(generator, token)).toBe(term);
  });
});

describe("arguments for a command run through Git Bash", () => {
  const platform = process.platform;
  beforeAll(() => Object.defineProperty(process, "platform", { value: "win32" }));
  afterAll(() => Object.defineProperty(process, "platform", { value: platform }));
  const bash = "C:\\Program Files\\Git\\bin\\bash.exe";
  test.each([
    ["C:\\Users\\me/.ssh/config", "'C:\\Users\\me/.ssh/config'"],
    ["src\\", "'src\\'"],
    ["two words", "'two words'"],
    ["it's", "'it'\\''s'"],
    ["a;b", "'a;b'"],
    ["--format=%h", "--format=%h"],
    ["~/.ssh/config", "~/.ssh/config"],
    ["*", "*"],
    ['"already quoted"', '"already quoted"'],
  ])("%s → %s", (arg, escaped) => {
    expect(escapeArgs(bash, [arg])).toEqual([escaped]);
  });
  test("the same answer every time (a /g regex alternated)", () => {
    const args = Array.from({ length: 6 }, () => "C:\\x y");
    expect(escapeArgs(bash, args)).toEqual(args.map(() => "'C:\\x y'"));
  });
  test("outside Windows nothing changes", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    expect(escapeArgs(bash, ["C:\\x y"])).toEqual(["C:\\x y"]);
    Object.defineProperty(process, "platform", { value: "win32" });
  });
});
