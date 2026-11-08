// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { findFixes, portInUse } from "../../runtime/extras/fixes.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thint-fixes-"));
fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: { build: "tsc", dev: "vite", test: "jest", lint: "eslint .", "dev:web": "x" } }));
for (const d of ["src", "packages", "Documents", "node_modules"]) fs.mkdirSync(path.join(dir, d));
fs.mkdirSync(path.join(dir, "packages", "web"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const commands = [
  "git",
  "gh",
  "go",
  "gt",
  "docker",
  "kubectl",
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "make",
  "python3",
  "ls",
  "cd",
  "cat",
  "grep",
  "terraform",
  "node",
];
const branches = async () => ["main", "develop", "feature/login", "fix/header", "release/1.2"];

const fix = async (command: string, exitCode: number, output: string) =>
  (await findFixes({ command, exitCode, output, cwd: dir }, () => commands, branches)).map((f) => f.command);

// a mistyped command, as each shell reports it
const notFound: [string, string, number, string, string][] = [
  ["zsh", "gti status", 127, "zsh: command not found: gti", "git status"],
  [
    "ubuntu command-not-found",
    "gti status",
    127,
    "Command 'gti' not found, did you mean:\n  command 'git' from deb git (1:2.43.0-1ubuntu7.3)\n  command 'gtg' from deb gtg (0.6-5)\nTry: sudo apt install <deb name>",
    "git status",
  ],
  ["bash", "gti status", 127, "bash: gti: command not found", "git status"],
  ["sh/dash", "gti status", 127, "sh: 1: gti: not found", "git status"],
  ["fish", "gti status", 127, "fish: Unknown command: gti\nfish:\ngti status\n^~^", "git status"],
  ["pwsh", "gti status", 1, "gti: The term 'gti' is not recognized as a name of a cmdlet, function, script file, or executable program.", "git status"],
  [
    "Windows PowerShell in a 40 column window",
    "gti status",
    1,
    "gti : The term 'gti' is not recog\n    nized as the name of a cmdlet, func\n    tion\nAt line:1 char:1\n+ gti status\n    + CategoryInfo          : ObjectNo\n   tFound: (gti:String) [], CommandNo\n  tFoundException",
    "git status",
  ],
  ["Windows PowerShell, only the end of the error left", "gti status", 1, "    + FullyQualifiedErrorId : CommandN\n   otFoundException", "git status"],
  ["cmd", "gti status", 9009, "'gti' is not recognized as an internal or external command,\noperable program or batch file.", "git status"],
  ["zsh", "dokcer ps", 127, "zsh: command not found: dokcer", "docker ps"],
  ["zsh", "kubeclt get pods", 127, "zsh: command not found: kubeclt", "kubectl get pods"],
  ["zsh", "pnmp i", 127, "zsh: command not found: pnmp", "pnpm i"],
  ["bash", "mkae build", 127, "bash: mkae: command not found", "make build"],
  ["zsh", "terrafrom plan", 127, "zsh: command not found: terrafrom", "terraform plan"],
  ["zsh", "yran dev", 127, "zsh: command not found: yran", "yarn dev"],
  ["zsh", "grpe -rn foo .", 127, "zsh: command not found: grpe", "grep -rn foo ."],
  ["zsh", "ndoe index.js", 127, "zsh: command not found: ndoe", "node index.js"],
  ["zsh", "sl -la", 127, "zsh: command not found: sl", "ls -la"],
  ["zsh", "ccat file", 127, "zsh: command not found: ccat", "cat file"],
  ["zsh", "pytohn3 x.py", 127, "zsh: command not found: pytohn3", "python3 x.py"],
  ["bash", "gti  status  -s", 127, "bash: gti: command not found", "git  status  -s"],
];

describe("a mistyped command", () => {
  test.each(notFound)("%s: %s", async (_shell, command, code, output, expected) => {
    expect((await fix(command, code, output))[0]).toBe(expected);
  });
});

const noFix: [string, string, number, string][] = [
  ["success", "gti status", 0, ""],
  ["Ctrl+C", "gti status", 130, ""],
  ["Ctrl+Z", "gti status", 148, "zsh: suspended  gti status"],
  ["nothing near", "qqqqqq", 127, "zsh: command not found: qqqqqq"],
  ["the word is right, something else failed", "git status", 128, "fatal: not a git repository (or any of the parent directories): .git"],
  ["127 without a not found message", "gti status", 127, "segmentation fault"],
  ["not found text but a normal failure code", "gti status", 2, "zsh: command not found: gti"],
  ["an empty line", "", 1, ""],
  ["only spaces", "   ", 1, ""],
  ["a script that printed not found itself", "./run.sh", 1, "user not found"],
  ["curl 404", "curl https://example.com/x", 22, "curl: (22) The requested URL returned error: 404 Not Found"],
  ["grep that found nothing", "grep foo file", 1, ""],
  ["a failing test run", "npm test", 1, "Tests: 1 failed, 3 passed"],
  ["git commit with nothing", "git commit -m wip", 1, "nothing to commit, working tree clean"],
  ["permission denied for a normal tool", "cat /etc/shadow", 1, "cat: /etc/shadow: Permission denied"],
  ["permission denied for npm (no sudo npm)", "npm i -g typescript", 243, "npm error code EACCES\nnpm error syscall mkdir"],
  ["mkdir that already has -p", "mkdir -p a/b", 1, "mkdir: a: Permission denied"],
  ["rm -r on a missing folder", "rm -r dist", 1, "rm: dist: No such file or directory"],
  ["cd with a near folder missing", "cd zzzzzz", 1, "cd: no such file or directory: zzzzzz"],
  ["cd with two words", "cd a b", 1, "cd: string not in pwd: a"],
  ["a missing script with nothing near", "npm run qqqqqqq", 1, 'npm error Missing script: "qqqqqqq"'],
  ["checkout to a far name", "git checkout zzzzzz", 1, "error: pathspec 'zzzzzz' did not match any file(s) known to git"],
];

describe("no fix", () => {
  test.each(noFix)("%s", async (_name, command, code, output) => {
    expect(await fix(command, code, output)).toEqual([]);
  });
});

// git, as git prints it
const gitCases: [string, string, number, string, string][] = [
  ["most similar", "git stauts", 1, "git: 'stauts' is not a git command. See 'git --help'.\n\nThe most similar command is\n\tstatus", "git status"],
  [
    "most similar, several",
    "git sta",
    1,
    "git: 'sta' is not a git command. See 'git --help'.\n\nThe most similar commands are\n\tstash\n\tstatus",
    "git stash",
  ],
  [
    "most similar with args",
    "git comit -m x",
    1,
    "git: 'comit' is not a git command. See 'git --help'.\n\nThe most similar command is\n\tcommit",
    "git commit -m x",
  ],
  ["most similar, pul", "git pul", 1, "git: 'pul' is not a git command. See 'git --help'.\n\nThe most similar commands are\n\tpull\n\tpush", "git pull"],
  [
    "push without upstream",
    "git push",
    128,
    "fatal: The current branch fix/login has no upstream branch.\nTo push the current branch and set the remote as upstream, use\n\n    git push --set-upstream origin fix/login\n\nTo have this happen automatically for branches without a tracking\nupstream, see 'push.autoSetupRemote' in 'git help config'.\n",
    "git push --set-upstream origin fix/login",
  ],
  [
    "push rejected, set upstream with -u form",
    "git push origin",
    128,
    "fatal: The current branch main has no upstream branch.\nTo push the current branch and set the remote as upstream, use\n\n    git push --set-upstream origin main\n",
    "git push --set-upstream origin main",
  ],
  ["checkout near branch", "git checkout mian", 1, "error: pathspec 'mian' did not match any file(s) known to git", "git checkout main"],
  ["checkout near branch, develop", "git checkout delevop", 1, "error: pathspec 'delevop' did not match any file(s) known to git", "git checkout develop"],
  ["switch near branch", "git switch mian", 128, "fatal: invalid reference: mian", "git switch main"],
  ["switch with a slash", "git switch feature/logn", 128, "fatal: invalid reference: feature/logn", "git switch feature/login"],
  ["checkout -b is skipped as an option", "git checkout -q mian", 1, "error: pathspec 'mian' did not match any file(s) known to git", "git checkout -q main"],
];

describe("git", () => {
  test.each(gitCases)("%s", async (_name, command, code, output, expected) => {
    expect(await fix(command, code, output)).toContain(expected);
  });
  test("a placeholder git prints is not offered as a command", async () => {
    const output =
      "There is no tracking information for the current branch.\nPlease specify which branch you want to merge with.\n\n    git pull <remote> <branch>\n\nIf you wish to set tracking information for this branch you can do so with:\n\n    git branch --set-upstream-to=origin/<branch> main\n";
    expect(await fix("git pull", 1, output)).toEqual([]);
  });
});

// package managers
const scriptCases: [string, string, number, string, string][] = [
  [
    "npm 10",
    "npm run biuld",
    1,
    'npm error Missing script: "biuld"\nnpm error\nnpm error To see a list of scripts, run:\nnpm error   npm run',
    "npm run build",
  ],
  ["npm 8", "npm run biuld", 1, 'npm ERR! Missing script: "biuld"', "npm run build"],
  ["npm run-script", "npm run-script tset", 1, 'npm error Missing script: "tset"', "npm run-script test"],
  ["npm start-like", "npm run lnit", 1, 'npm error Missing script: "lnit"', "npm run lint"],
  ["pnpm 8+", "pnpm run biuld", 1, ' ERR_PNPM_NO_SCRIPT  Missing script: biuld\n\nCommand "biuld" not found.', "pnpm run build"],
  ["pnpm without run", "pnpm biuld", 1, ' ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command "biuld" not found', "pnpm build"],
  ["yarn 1", "yarn biuld", 1, 'yarn run v1.22.22\nerror Command "biuld" not found.', "yarn build"],
  ["yarn berry", "yarn run biuld", 1, 'Usage Error: Couldn\'t find a script named "biuld".', "yarn run build"],
  ["bun", "bun run biuld", 1, 'error: Script not found "biuld"', "bun run build"],
  ["near with a colon", "npm run dev:wbe", 1, 'npm error Missing script: "dev:wbe"', "npm run dev:web"],
];

describe("package scripts", () => {
  test.each(scriptCases)("%s", async (_name, command, code, output, expected) => {
    expect((await fix(command, code, output))[0]).toBe(expected);
  });
  test("no package.json: no script fix", async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "thint-nopkg-"));
    const fixes = await findFixes({ command: "npm run biuld", exitCode: 1, output: 'npm error Missing script: "biuld"', cwd: empty }, () => [], branches);
    expect(fixes).toEqual([]);
    fs.rmSync(empty, { recursive: true });
  });
  test("a broken package.json does not throw", async () => {
    const broken = fs.mkdtempSync(path.join(os.tmpdir(), "thint-badpkg-"));
    fs.writeFileSync(path.join(broken, "package.json"), "{ not json");
    const fixes = await findFixes({ command: "npm run biuld", exitCode: 1, output: 'npm error Missing script: "biuld"', cwd: broken }, () => [], branches);
    expect(fixes).toEqual([]);
    fs.rmSync(broken, { recursive: true });
  });
});

// folders and files, GNU and BSD wording
const fileCases: [string, string, number, string, string][] = [
  ["mkdir BSD", "mkdir a/b", 1, "mkdir: a: No such file or directory", "mkdir -p a/b"],
  ["mkdir GNU", "mkdir a/b/c", 1, "mkdir: cannot create directory ‘a/b/c’: No such file or directory", "mkdir -p a/b/c"],
  ["mkdir several", "mkdir x/y z/w", 1, "mkdir: x: No such file or directory", "mkdir -p x/y z/w"],
  ["rm BSD", "rm dist", 1, "rm: dist: is a directory", "rm -r dist"],
  ["rm GNU", "rm dist", 1, "rm: cannot remove 'dist': Is a directory", "rm -r dist"],
  ["rm -f keeps -f", "rm -f build", 1, "rm: build: is a directory", "rm -r -f build"],
  ["cd zsh", "cd scr", 1, "cd: no such file or directory: scr", "cd src/"],
  ["cd bash", "cd scr", 1, "bash: cd: scr: No such file or directory", "cd src/"],
  ["cd fish", "cd scr", 1, "cd: The directory 'scr' does not exist", "cd src/"],
  ["cd pwsh", "cd scr", 1, "Set-Location: Cannot find path '/tmp/scr' because it does not exist.", "cd src/"],
  ["cd with a trailing slash", "cd scr/", 1, "cd: no such file or directory: scr/", "cd src/"],
  ["cd nested", "cd packages/wbe", 1, "cd: no such file or directory: packages/wbe", "cd packages/web/"],
  ["cd case", "cd documents", 1, "cd: no such file or directory: documents", "cd Documents/"],
];

describe("files and folders", () => {
  test.each(fileCases)("%s", async (_name, command, code, output, expected) => {
    expect((await fix(command, code, output))[0]).toBe(expected);
  });
});

const sudoCases: [string, number, string, string | undefined][] = [
  [
    "apt install htop",
    100,
    "E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)\nE: are you root?",
    "sudo apt install htop",
  ],
  ["apt-get update", 100, "E: List directory /var/lib/apt/lists/partial is missing. - Acquire (13: Permission denied)", "sudo apt-get update"],
  [
    "dnf install git",
    1,
    "Error: This command has to be run with superuser privileges (under the root user on most systems). Permission denied",
    "sudo dnf install git",
  ],
  ["pacman -S git", 1, "error: you cannot perform this operation unless you are root.", undefined],
  [
    "systemctl restart nginx",
    1,
    "Failed to restart nginx.service: Access denied\nSee system logs and 'systemctl status nginx.service' for details. Permission denied",
    "sudo systemctl restart nginx",
  ],
  [
    "docker ps",
    1,
    'permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock: Get "http://%2Fvar%2Frun%2Fdocker.sock/v1.24/containers/json": dial unix /var/run/docker.sock: connect: permission denied',
    "sudo docker ps",
  ],
  ["sudo apt install htop", 100, "E: Permission denied", undefined],
  ["npm i -g x", 243, "npm error code EACCES", undefined],
  ["cp a /etc/b", 1, "cp: /etc/b: Permission denied", undefined],
  ["chown me file", 1, "chown: file: Operation not permitted", "sudo chown me file"],
];

describe("sudo, only for commands that are run that way", () => {
  test.each(sudoCases)("%s", async (command, code, output, expected) => {
    const fixes = await fix(command, code, output);
    if (expected == null) expect(fixes.filter((f) => f.startsWith("sudo"))).toEqual([]);
    else expect(fixes).toContain(expected);
  });
});

const ports: [string, string, string, number][] = [
  ["node", "node server.js", "Error: listen EADDRINUSE: address already in use :::3000\n    at Server.setupListenHandle", 3000],
  ["node ipv4", "node app.js", "Error: listen EADDRINUSE: address already in use 127.0.0.1:8080", 8080],
  ["next", "pnpm dev", " ⨯ Failed to start server\nError: listen EADDRINUSE: address already in use :::3000", 3000],
  ["vite strict", "npm run dev", "error when starting dev server:\nError: Port 5173 is already in use", 5173],
  ["vite short", "vite", "Port 4173 is in use", 4173],
  ["python, port from the command", "python3 -m http.server 8177", "OSError: [Errno 98] Address already in use", 8177],
  ["python mac", "python3 -m http.server 9000", "OSError: [Errno 48] Address already in use", 9000],
  ["rails", "bin/rails s", 'Address already in use - bind(2) for "127.0.0.1" port 3000 (Errno::EADDRINUSE)', 3000],
  [
    "docker",
    "docker run -p 8080:80 nginx",
    "docker: Error response from daemon: driver failed programming external connectivity: Bind for 0.0.0.0:8080 failed: port is already allocated.",
    8080,
  ],
  ["go", "go run .", "listen tcp :8081: bind: address already in use", 8081],
  ["go ipv6", "go run .", "listen tcp6 [::]:8082: bind: address already in use", 8082],
  ["uvicorn", "uvicorn main:app", "ERROR:    [Errno 98] error while attempting to bind on address ('127.0.0.1', 8000): address already in use", 8000],
  ["--port in the command", "serve --port 4000", "Error: address already in use", 4000],
  ["--port= in the command", "serve --port=4001", "Error: address already in use", 4001],
  ["-p in the command", "http-server -p 4002", "Error: EADDRINUSE", 4002],
  ["a bare number in the command", "php -S localhost:8888", "Failed to listen on localhost:8888 (reason: Address already in use)", 8888],
  ["not about a port", "npm run dev", "Error: Cannot find module 'x'", 0],
  ["in use, no port anywhere", "npm run dev", "Error: address already in use", 0],
  ["a port out of range", "node x.js", "Error: listen EADDRINUSE: address already in use :::99999", 0],
];

describe("the port that is taken", () => {
  test.each(ports)("%s", (_name, command, output, expected) => {
    expect(portInUse({ command, exitCode: 1, output, cwd: dir })).toBe(expected);
  });
});

describe("what fixes never do", () => {
  const all = [...notFound, ...gitCases, ...scriptCases, ...fileCases];
  test.each(all.map((c) => [c[1], c[2], c[3]] as [string, number, string]))(
    "%s: at most 3, never the same line, never sudo rm",
    async (command, code, output) => {
      const fixes = await fix(command, code, output);
      expect(fixes.length).toBeLessThanOrEqual(3);
      expect(new Set(fixes).size).toBe(fixes.length);
      for (const f of fixes) {
        expect(f.trim()).not.toBe(command.trim());
        expect(f).not.toMatch(/^sudo\s+rm\b/);
        expect(f).not.toMatch(/[\r\n]/);
      }
    },
  );
});
