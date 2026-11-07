// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import { parseLsof, parseSs, shortCommand } from "../../runtime/extras/processes.js";
import { describeRecent, rankCommands } from "../../runtime/extras/recent.js";

// lines of `ss -ltnpH`, as Linux prints them
const ssLines: [string, string, { port: number; pid: number; command: string }[]][] = [
  ["IPv4", 'LISTEN 0      511          127.0.0.1:3000       0.0.0.0:*    users:(("node",pid=4242,fd=21))', [{ port: 3000, pid: 4242, command: "node" }]],
  [
    "IPv4 any",
    'LISTEN 0      4096           0.0.0.0:8080       0.0.0.0:*    users:(("docker-proxy",pid=901,fd=4))',
    [{ port: 8080, pid: 901, command: "docker-proxy" }],
  ],
  ["IPv6", 'LISTEN 0      511                [::]:5173          [::]:*    users:(("node",pid=77,fd=30))', [{ port: 5173, pid: 77, command: "node" }]],
  ["IPv6 localhost", 'LISTEN 0      511               [::1]:4000          [::]:*    users:(("ruby",pid=12,fd=9))', [{ port: 4000, pid: 12, command: "ruby" }]],
  ["star", 'LISTEN 0      128                  *:22               *:*    users:(("sshd",pid=1,fd=3))', [{ port: 22, pid: 1, command: "sshd" }]],
  [
    "interface suffix",
    'LISTEN 0      4096     127.0.0.53%lo:53         0.0.0.0:*    users:(("systemd-resolve",pid=500,fd=14))',
    [{ port: 53, pid: 500, command: "systemd-resolve" }],
  ],
  [
    "two processes on one port",
    'LISTEN 0 511 0.0.0.0:3000 0.0.0.0:* users:(("node",pid=10,fd=21),("node",pid=11,fd=21))',
    [{ port: 3000, pid: 10, command: "node" }],
  ],
  ["no process (another user's)", "LISTEN 0      511          0.0.0.0:631       0.0.0.0:*", []],
  ["a command with a space", 'LISTEN 0 511 0.0.0.0:9229 0.0.0.0:* users:(("node --inspect",pid=5,fd=1))', [{ port: 9229, pid: 5, command: "node --inspect" }]],
  ["empty", "", []],
];

describe("listening ports from ss", () => {
  test.each(ssLines)("%s", (_name, line, expected) => expect(parseSs(line)).toEqual(expected));
  test("many lines", () => expect(parseSs(ssLines.map((l) => l[1]).join("\n")).length).toBe(8));
});

const lsofOut: [string, string, { port: number; pid: number; command: string }[]][] = [
  ["one", "p4242\ncnode\nn*:3000\n", [{ port: 3000, pid: 4242, command: "node" }]],
  [
    "two addresses",
    "p4242\ncnode\nn127.0.0.1:3000\nn[::1]:3000\n",
    [
      { port: 3000, pid: 4242, command: "node" },
      { port: 3000, pid: 4242, command: "node" },
    ],
  ],
  [
    "two processes",
    "p1\ncpostgres\nn*:5432\np2\ncredis-ser\nn127.0.0.1:6379\n",
    [
      { port: 5432, pid: 1, command: "postgres" },
      { port: 6379, pid: 2, command: "redis-ser" },
    ],
  ],
  ["a field without a port", "p9\ncx\nnlocalhost\n", []],
  ["file descriptor lines are ignored", "p9\ncx\nf21\nn*:80\n", [{ port: 80, pid: 9, command: "x" }]],
  ["empty", "", []],
];

describe("listening ports from lsof", () => {
  test.each(lsofOut)("%s", (_name, out, expected) => expect(parseLsof(out)).toEqual(expected));
});

const commands: [string | undefined, string, string][] = [
  ["node /home/me/shop/node_modules/.bin/next dev", "node", "next dev"],
  ["node /x/node_modules/next/dist/bin/next start -p 3000", "node", "next start -p 3000"],
  ["node /x/node_modules/.bin/vite --port 5173", "node", "vite --port 5173"],
  ["/usr/bin/python3 -m http.server 8000", "python3", "python3 -m http.server 8000"],
  ["/usr/sbin/sshd -D", "sshd", "sshd -D"],
  ["ruby bin/rails server -b 0.0.0.0 -p 3000", "ruby", "ruby bin/rails server -b"], // four words at most
  ["postgres", "postgres", "postgres"],
  [undefined, "node", "node"],
  ["", "node", "node"],
];

describe("a short name for the process", () => {
  test.each(commands)("%s", (full, fallback, short) => expect(shortCommand(full, fallback)).toBe(short));
});

const now = Date.parse("2026-11-07T12:00:00Z");
const minute = 60_000;
const day = 24 * 60 * minute;
const history = [
  { command: "git push origin main", cwd: "/a", time: now - 5 * minute },
  { command: "git push origin main", cwd: "/a", time: now - 2 * day },
  { command: "git pull --rebase", cwd: "/a", time: now - 1 * minute },
  { command: "git status -s", cwd: "/b", time: now - minute },
  { command: "npm run dev", cwd: "/a", time: now - 30 * day },
  { command: "git log --oneline", cwd: "/a", time: now - 90 * day },
  { command: "export GITHUB_TOKEN=abc123 && git push", cwd: "/a", time: now },
];

const ranks: [string, string, string[]][] = [
  ["/a", "git", ["git push origin main", "git pull --rebase", "git log --oneline"]],
  ["/a", "git pu", ["git push origin main", "git pull --rebase"]],
  ["/a", "npm", ["npm run dev"]],
  ["/b", "git", ["git status -s"]],
  ["/c", "git", []],
  ["/a", "export", []],
  ["/a", "", ["git push origin main", "git pull --rebase", "npm run dev", "git log --oneline"]],
];

describe("whole commands ran in this folder", () => {
  test.each(ranks)("%s %s", (cwd, prefix, expected) => expect(rankCommands(history, cwd, prefix, now).map((r) => r.command)).toEqual(expected));
  test("counts and the last time", () => {
    const [top] = rankCommands(history, "/a", "git push", now);
    expect(top.count).toBe(2);
    expect(describeRecent(top, now)).toBe("ran here 2×, last 5 minutes ago");
  });
  test("once", () => {
    const [top] = rankCommands(history, "/a", "npm", now);
    expect(describeRecent(top, now)).toBe("ran here 4 weeks ago");
  });
});
