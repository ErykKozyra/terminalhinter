// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import { parseCommand } from "../../runtime/parser.js";
import { Shell } from "../../utils/shell.js";

// [shell, line, tokens as "word" (done), "word…" (being typed), with "-" in front of options read as options]
type Row = [Shell, string, string[]];
const show = (line: string, shell: Shell) => parseCommand(line, shell).map((t) => `${t.isOption ? "opt:" : ""}${t.token}${t.complete ? "" : "…"}`);

const posix: Row[] = [
  // plain words
  [Shell.Bash, "", []],
  [Shell.Bash, "   ", []],
  [Shell.Bash, "git", ["git…"]],
  [Shell.Bash, "git ", ["git"]],
  [Shell.Bash, "git sta", ["git", "sta…"]],
  [Shell.Bash, "git status ", ["git", "status"]],
  [Shell.Bash, "  git   status   ", ["git", "status"]],
  [Shell.Bash, "git\tstatus ", ["git", "status"]],
  // options
  [Shell.Bash, "ls -la", ["ls", "opt:-la…"]],
  [Shell.Bash, "ls -la ", ["ls", "opt:-la"]],
  [Shell.Bash, "ls --all ", ["ls", "opt:--all"]],
  [Shell.Bash, "ls -", ["ls", "opt:-…"]],
  [Shell.Bash, "ls --", ["ls", "opt:--…"]],
  [Shell.Bash, "git log --format=%H ", ["git", "log", "opt:--format", "%H"]],
  [Shell.Bash, "git log --format=", ["git", "log", "opt:--format"]],
  [Shell.Bash, "kubectl get pods -o=json", ["kubectl", "get", "pods", "opt:-o", "json…"]],
  [Shell.Bash, "npm run -- --watch", ["npm", "run", "opt:--", "opt:--watch…"]],
  [Shell.Bash, "docker run -p 8080:80 nginx ", ["docker", "run", "opt:-p", "8080:80", "nginx"]],
  // quotes
  [Shell.Bash, 'git commit -m "hello world" ', ["git", "commit", "opt:-m", "hello world"]],
  [Shell.Bash, 'git commit -m "hello', ["git", "commit", "opt:-m", "hello…"]],
  [Shell.Bash, 'git commit -m "', ["git", "commit", "opt:-m", "…"]],
  [Shell.Bash, "echo 'a b' c", ["echo", "a b", "c…"]],
  [Shell.Bash, "echo 'a b' ", ["echo", "a b"]],
  [Shell.Bash, 'echo "it\'s" ', ["echo", "it's"]],
  [Shell.Bash, "echo 'say \"hi\"' ", ["echo", 'say "hi"']],
  [Shell.Bash, 'ls "a"b ', ["ls", "ab"]],
  [Shell.Bash, 'git log --format="%H %s" ', ["git", "log", "opt:--format", "%H %s"]],
  [Shell.Bash, 'cd "My Drive"/', ["cd", "My Drive/…"]],
  [Shell.Bash, "echo `date` x", ["echo", "date", "x…"]],
  // escapes
  [Shell.Bash, "cd my\\ app/", ["cd", "my app/…"]],
  [Shell.Bash, "cd my\\ app/ ", ["cd", "my app/"]],
  [Shell.Bash, "ls my\\ app\\ \\(v2\\)/", ["ls", "my app (v2)/…"]],
  [Shell.Bash, "cd ~/My\\ Drive", ["cd", "~/My Drive…"]],
  [Shell.Bash, "cat it\\'s.txt ", ["cat", "it's.txt"]],
  [Shell.Bash, "cat a\\&b ", ["cat", "a&b"]],
  [Shell.Zsh, "cd my\\ app/", ["cd", "my app/…"]],
  [Shell.Fish, "cd my\\ app/", ["cd", "my app/…"]],
  // only the last command of a line is completed
  [Shell.Bash, "ls | grep foo", ["grep", "foo…"]],
  [Shell.Bash, "ls | grep ", ["grep"]],
  [Shell.Bash, "make && make test", ["make", "test…"]],
  [Shell.Bash, "make || echo failed ", ["echo", "failed"]],
  [Shell.Bash, "a; b ", ["b"]],
  [Shell.Bash, "cd src && git ", ["git"]],
  [Shell.Bash, "cat x | sort | uniq -c ", ["uniq", "opt:-c"]],
  [Shell.Bash, "ls &&", []],
  // operators inside quotes do not split the line
  [Shell.Bash, 'git commit -m "a && b" --am', ["git", "commit", "opt:-m", "a && b", "opt:--am…"]],
  [Shell.Bash, "echo 'a | b' ", ["echo", "a | b"]],
  [Shell.Bash, 'echo "x; y" && git ', ["git"]],
  [Shell.Bash, "echo a\\;b ", ["echo", "a;b"]],
  [Shell.Bash, "ls 2>&1 | grep x", ["grep", "x…"]],
  // = only splits an option from its value
  [Shell.Bash, "FOO=1 node ", ["FOO=1", "node"]],
  [Shell.Bash, "NODE_ENV=production node x.js ", ["NODE_ENV=production", "node", "x.js"]],
  [Shell.Bash, "dd if=/dev/zero of=out.img ", ["dd", "if=/dev/zero", "of=out.img"]],
  [Shell.Bash, "make deploy ENV=staging ", ["make", "deploy", "ENV=staging"]],
  [Shell.Bash, "git log --since=2.weeks ", ["git", "log", "opt:--since", "2.weeks"]],
  // redirects stay words
  [Shell.Bash, "ls > out.txt ", ["ls", ">", "out.txt"]],
  [Shell.Bash, "ls 2>&1 ", ["ls", "2>&1"]],
  // unicode and Polish letters
  [Shell.Bash, "cat żółw.txt ", ["cat", "żółw.txt"]],
  [Shell.Bash, "cd Pobrane/zdjęcia ", ["cd", "Pobrane/zdjęcia"]],
  [Shell.Bash, "cd Pobrane/zdję", ["cd", "Pobrane/zdję…"]],
  [Shell.Bash, "echo 🎉 x", ["echo", "🎉", "x…"]],
  [Shell.Bash, "echo 日本語 ", ["echo", "日本語"]],
  [Shell.Bash, 'git commit -m "Poprawka logowania, ąęśćźżółń" ', ["git", "commit", "opt:-m", "Poprawka logowania, ąęśćźżółń"]],
];

const windows: Row[] = [
  [Shell.Pwsh, "cd my` app", ["cd", "my app…"]],
  [Shell.Pwsh, 'Get-ChildItem -Path "C:\\Program Files" ', ["Get-ChildItem", "opt:-Path", "C:\\Program Files"]],
  [Shell.Pwsh, "cd C:\\Users\\eryk\\", ["cd", "C:\\Users\\eryk\\…"]],
  [Shell.Pwsh, "git status; git ", ["git"]],
  [Shell.Pwsh, "Get-Process | Stop-Process -Name ", ["Stop-Process", "opt:-Name"]],
  [Shell.Cmd, 'cd "C:\\Program Files"\\', ["cd", "C:\\Program Files\\…"]],
  [Shell.Cmd, "dir /s", ["dir", "/s…"]],
  [Shell.Cmd, "dir && git ", ["git"]],
];

describe("parsing a line", () => {
  test.each([...posix, ...windows])("%s: %j", (shell, line, expected) => {
    expect(show(line, shell)).toEqual(expected);
  });
});

// how wide the token is on screen decides where the list opens
const widths: [string, number][] = [
  ["cd żółw", 4],
  ["cd 日本", 4],
  ["cd ab", 2],
  ['cd "a b"', 5],
  ['cd "a b', 4],
  ["echo 🎉", 2],
];

describe("token widths", () => {
  test.each(widths)("%s", (line, width) => {
    expect(parseCommand(line, Shell.Bash).at(-1)?.tokenLength).toBe(width);
  });
});
