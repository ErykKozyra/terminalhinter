// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import { explainCommand } from "../../runtime/runtime.js";
import { Shell } from "../../utils/shell.js";

// [line, the words in order, [word, a piece of what it says][], a piece of a note or nothing]
type Row = [string, string[], [string, RegExp][], RegExp | undefined];

const rows: Row[] = [
  ["ls -la", ["ls", "-la"], [["-la", /-l: .*; -a: /]], undefined],
  ["grep -rn foo .", ["grep", "-rn", "foo", "."], [["-rn", /-r: .*; -n: /]], undefined],
  [
    "tar -xzvf file.tgz",
    ["tar", "-xzvf", "file.tgz"],
    [
      ["-xzvf", /^-x: Extract.*-z: .*gzip.*-v: .*-f: /i],
      ["file.tgz", /value of -f/],
    ],
    undefined,
  ],
  [
    "tar -czf out.tgz src",
    ["tar", "-czf", "out.tgz", "src"],
    [
      ["-czf", /^-c: Create/i],
      ["out.tgz", /value of -f/],
    ],
    undefined,
  ],
  [
    "tar xzf a.tgz",
    ["tar", "xzf", "a.tgz"],
    [
      ["xzf", /^-x: Extract/i],
      ["a.tgz", /value of -f/],
    ],
    undefined,
  ],
  ["tar -tvf a.tar", ["tar", "-tvf", "a.tar"], [["-tvf", /^-t: /]], undefined],
  ["ps aux", ["ps", "aux"], [["aux", /a: processes of every user; u: .*; x: also processes without a terminal/]], undefined],
  ["ps -ef", ["ps", "-ef"], [], undefined],
  [
    "kubectl --context prod get pods",
    ["kubectl", "--context", "prod", "get", "pods"],
    [
      ["--context", /context/i],
      ["prod", /value of --context/],
    ],
    /production context/,
  ],
  ["kubectl get pods --context=staging", ["kubectl", "get", "pods", "--context", "staging"], [["--context", /context/i]], undefined],
  ["kubectl --kubeconfig ~/.kube/c get ns", ["kubectl", "--kubeconfig", "~/.kube/c", "get", "ns"], [["--kubeconfig", /kubeconfig file/i]], undefined],
  ["rm -rf dist", ["rm", "-rf", "dist"], [["-rf", /-r: .*; -f: /]], /deletes folders/],
  ["rm -rf /", ["rm", "-rf", "/"], [], /whole tree/],
  ["git push --force origin main", ["git", "push", "--force", "origin", "main"], [["push", /.+/]], /force push to a main branch/],
  ["git reset --hard HEAD~1", ["git", "reset", "--hard", "HEAD~1"], [["--hard", /.+/]], /uncommitted/],
  ["sudo apt install htop", ["sudo", "apt", "install", "htop"], [["sudo", /administrator/]], /administrator/],
  ["sudo -E npm i", ["sudo", "-E", "npm", "i"], [["-E", /option of sudo/]], /administrator/],
  ["env FOO=1 node x.js", ["env", "FOO=1", "node", "x.js"], [["FOO=1", /environment variable/]], undefined],
  ["NODE_ENV=production node x.js", ["NODE_ENV=production", "node", "x.js"], [["NODE_ENV=production", /environment variable/]], undefined],
  ["time make", ["time", "make"], [["time", /how long/]], undefined],
  ["ls | grep foo", ["ls", "|", "grep", "foo"], [["|", /output into the next/]], undefined],
  ["make && make test", ["make", "&&", "make", "test"], [["&&", /if this one worked/]], undefined],
  ["make || echo no", ["make", "||", "echo", "no"], [["||", /if this one failed/]], undefined],
  ["a ; b", ["a", ";", "b"], [[";", /then runs/]], undefined],
  [
    "ls > out.txt",
    ["ls", ">", "out.txt"],
    [
      [">", /replacing/],
      ["out.txt", /the file/],
    ],
    undefined,
  ],
  ["ls >> log.txt", ["ls", ">>", "log.txt"], [[">>", /end of the file/]], undefined],
  ["sort < in.txt", ["sort", "<", "in.txt"], [["<", /reads the input/]], undefined],
  ["make 2>&1 | tee log", ["make", "2>&1", "|", "tee", "log"], [["2>&1", /errors where the output goes/]], undefined],
  ["make 2> err.txt", ["make", "2>", "err.txt"], [["2>", /errors to the file/]], undefined],
  ["make &> all.txt", ["make", "&>", "all.txt"], [["&>", /output and errors/]], undefined],
  ["sleep 10 &", ["sleep", "10", "&"], [["&", /background/]], undefined],
  ['echo "a | b"', ["echo", "a | b"], [], undefined],
  ["git commit -m 'a && b'", ["git", "commit", "-m", "a && b"], [["-m", /.+/]], undefined],
  ["docker compose down -v", ["docker", "compose", "down", "-v"], [], /volumes/],
  ["qqqzzz --x", ["qqqzzz", "--x"], [["qqqzzz", /no description/]], undefined],
];

describe("Ctrl+G explains a line", () => {
  test.each(rows)("%s", async (line, words, says, note) => {
    const result = await explainCommand(line, Shell.Bash);
    expect(result?.mode).toBe("explain");
    expect(result?.suggestions.map((s) => s.name)).toEqual(words);
    for (const [word, pattern] of says) expect(result?.suggestions.find((s) => s.name === word)?.description).toMatch(pattern);
    if (note) expect(result?.notes?.some((n) => note.test(n))).toBe(true);
  });
  test("an empty line explains nothing", async () => {
    expect(await explainCommand("", Shell.Bash)).toBeUndefined();
    expect(await explainCommand("   ", Shell.Bash)).toBeUndefined();
  });
  test("no unknown option left in common bundles", async () => {
    for (const line of ["tar -xzvf a.tgz", "tar -cjf b.tbz x", "ls -lah", "rm -rf x", "grep -rni x .", "kubectl --context x get pods"]) {
      const result = await explainCommand(line, Shell.Bash);
      expect(result?.suggestions.filter((s) => s.description === "unknown option").map((s) => s.name)).toEqual([]);
    }
  });
});
