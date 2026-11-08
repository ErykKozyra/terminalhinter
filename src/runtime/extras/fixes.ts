// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// After a command fails, the next prompt offers a fix: a mistyped command or subcommand, a missing upstream branch,
// a missing script, a folder that needs -p or -r, a port that is taken. Only offered, never run by itself.

import fs from "node:fs";
import path from "node:path";

import { closest } from "./util.js";
import { listeningProcesses } from "./processes.js";

export type Failure = { command: string; exitCode: number; output: string; cwd: string; shell?: string };

// how to stop a process in the shell the command failed in
export const killCommand = (pid: number, shell: string | undefined, platform = process.platform): string => {
  if (shell === "cmd") return `taskkill /PID ${pid} /F`;
  if (shell === "pwsh" || shell === "powershell") return `Stop-Process -Id ${pid}`;
  // Git Bash turns /PID into a Windows path, a doubled slash keeps it as it is
  if (platform === "win32") return `taskkill //PID ${pid} //F`;
  return `kill ${pid}`;
};
export type Fix = { command: string; reason: string };

const lines = (output: string) => output.split(/\r?\n/).map((l) => l.replace(/\s+$/, ""));

// commands the output itself suggests, indented on their own line: git and npm both do that
const suggestedCommands = (output: string, root: string): string[] =>
  lines(output)
    .map((l) => l.match(new RegExp(`^\\s{2,}(${root} [^\\n]+)$`))?.[1]?.trim())
    // `git branch --set-upstream-to=origin/<branch> main` has a placeholder to fill in, it is not a command to run
    .filter((c): c is string => c != null && c.length < 200 && !/<[^>\s]+>/.test(c));

const replaceWord = (command: string, index: number, word: string): string => {
  const words = command.split(/(\s+)/);
  let seen = -1;
  return words.map((w) => (/^\s+$/.test(w) || w === "" ? w : ++seen === index ? word : w)).join("");
};

type Context = { failure: Failure; words: string[]; commands: () => Iterable<string>; branches: () => Promise<string[]> };
type Rule = (c: Context) => Fix[] | Promise<Fix[]>;

// Windows PowerShell breaks its error to the window with an indent, in the middle of a word too ("CommandN" and
// "   otFoundException" on the next row): the text read both ways, the rows joined with a space and with nothing
const unwrapped = (output: string): string[] => [output, output.replace(/\s*\n\s*/g, " "), output.replace(/\n\s*/g, "")];

const rules: Rule[] = [
  // zsh: command not found: gti / bash: gti: command not found / sh: 1: gti: not found / fish: Unknown command: gti /
  // PowerShell: The term 'gti' is not recognized / cmd: 'gti' is not recognized as an internal or external command /
  // Ubuntu's command-not-found: Command 'gti' not found, did you mean: command 'git' from deb git
  ({ failure, words, commands }) => {
    const notFound = /command not found|: not found|Unknown command|command '[^']*' not found/i.test(failure.output);
    const notRecognized = unwrapped(failure.output).some((text) => /is not recognized as|CommandNotFoundException/i.test(text));
    if (!((failure.exitCode === 127 && notFound) || ((failure.exitCode === 9009 || failure.exitCode === 1) && notRecognized))) return [];
    const match = closest(words[0], commands());
    return match ? [{ command: replaceWord(failure.command, 0, match), reason: `"${words[0]}" is not a command, ${match} is` }] : [];
  },
  // git: 'stauts' is not a git command ... The most similar command is status
  ({ failure, words }) => {
    if (words[0] !== "git") return [];
    const similar = failure.output.match(/most similar commands? (?:is|are)\s*\n\s*(\S+)/);
    return similar ? [{ command: replaceWord(failure.command, 1, similar[1]), reason: `git suggests ${similar[1]}` }] : [];
  },
  // git push without an upstream, and other commands git spells out
  ({ failure, words }) => {
    if (words[0] !== "git") return [];
    return suggestedCommands(failure.output, "git")
      .filter((c) => c !== failure.command)
      .slice(0, 2)
      .map((command) => ({ command, reason: "the command git suggests" }));
  },
  // git checkout / switch to a branch that does not exist, with a near name that does
  async ({ failure, words, branches }) => {
    if (words[0] !== "git" || !["checkout", "switch"].includes(words[1] ?? "")) return [];
    if (!/did not match any|invalid reference|not a commit/.test(failure.output)) return [];
    const wanted = words.slice(2).find((w) => !w.startsWith("-"));
    if (!wanted) return [];
    const match = closest(wanted, await branches(), 3);
    return match ? [{ command: failure.command.replace(wanted, match), reason: `no branch "${wanted}", did you mean ${match}?` }] : [];
  },
  // npm error Missing script: "biuld" / pnpm: Command "biuld" not found
  ({ failure, words }) => {
    if (!["npm", "pnpm", "yarn", "bun"].includes(words[0])) return [];
    const missing = failure.output.match(
      /Missing script: "?([^"\s]+)"?|Command "([^"]+)" not found|Script not found "([^"]+)"|Couldn't find a script named "([^"]+)"/,
    );
    if (!missing) return [];
    const wanted = missing[1] ?? missing[2] ?? missing[3] ?? missing[4];
    let scripts: string[] = [];
    try {
      scripts = Object.keys((JSON.parse(fs.readFileSync(path.join(failure.cwd, "package.json"), "utf8")) as { scripts?: object }).scripts ?? {});
    } catch {
      /* no package.json here */
    }
    const match = closest(wanted, scripts, 3);
    if (!match) return [];
    const index = words.indexOf(wanted);
    return index > 0 ? [{ command: replaceWord(failure.command, index, match), reason: `no script "${wanted}", there is ${match}` }] : [];
  },
  // mkdir: a/b: No such file or directory → mkdir -p
  ({ failure, words }) =>
    words[0] === "mkdir" && !words.includes("-p") && /No such file or directory/.test(failure.output)
      ? [{ command: failure.command.replace(/^mkdir\b/, "mkdir -p"), reason: "creates the missing parent folders too" }]
      : [],
  // rm: x: is a directory → rm -r
  ({ failure, words }) =>
    words[0] === "rm" && /is a directory/i.test(failure.output) && !words.some((w) => /^-[a-zA-Z]*[rR]/.test(w))
      ? [{ command: failure.command.replace(/^rm\b/, "rm -r"), reason: "deletes the folder and what is in it" }]
      : [],
  // cd into a folder that is not there, with a near name that is
  ({ failure, words }) => {
    if (words[0] !== "cd" || words.length !== 2 || !/no such file or directory|not a directory|does not exist|cannot find path/i.test(failure.output))
      return [];
    const target = words[1].replace(/\/+$/, "");
    const parent = path.resolve(failure.cwd, path.dirname(target));
    let dirs: string[] = [];
    try {
      dirs = fs
        .readdirSync(parent, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      return [];
    }
    const match = closest(path.basename(target), dirs, 2);
    const dir = path.dirname(target);
    return match ? [{ command: `cd ${dir === "." ? "" : dir + "/"}${match}/`, reason: `no folder "${path.basename(target)}", there is ${match}` }] : [];
  },
  // EADDRINUSE / address already in use :3000 → kill what holds the port
  async ({ failure }) => {
    const port = portInUse(failure);
    if (!port) return [];
    const holder = (await listeningProcesses()).find((l) => l.port === port);
    return holder
      ? [
          { command: killCommand(holder.pid, failure.shell), reason: `port ${port} is held by ${holder.command}` },
          { command: failure.command, reason: "then run it again" },
        ]
      : [];
  },
  // permission denied → sudo, but only for commands that are normally run that way
  ({ failure, words }) =>
    /permission denied|EACCES|Operation not permitted|are you root/i.test(failure.output) &&
    words[0] !== "sudo" &&
    // not npm: `sudo npm i -g` leaves root-owned files behind, the fix there is a Node version manager
    ["apt", "apt-get", "dnf", "yum", "pacman", "zypper", "systemctl", "chown", "mount", "umount", "docker", "service", "snap"].includes(words[0])
      ? [{ command: `sudo ${failure.command}`, reason: "needs administrator rights" }]
      : [],
];

// The port a failed server could not get: from the message, or else from the command (python's message has none:
// `http.server 8177`, -p 8177). 0 when the failure is not about a port in use.
export const portInUse = (failure: Failure): number => {
  if (!/EADDRINUSE|address already in use|port is already allocated|already in use|address in use|\bport \d+ is in use/i.test(failure.output)) return 0;
  const fromOutput = [
    /(?:EADDRINUSE|address already in use)[^\n]*?:(\d{2,5})\b/i, // node, next: listen EADDRINUSE: address already in use :::3000
    /\bport\s+(\d{2,5})\s+is\s+(?:already\s+)?in use/i, // vite: Port 5173 is already in use
    /Bind for [^\s]*:(\d{2,5}) failed/i, // docker: Bind for 0.0.0.0:8080 failed: port is already allocated
    /listen tcp[46]? [^\s]*:(\d{2,5}): bind/i, // go: listen tcp :8080: bind: address already in use
    /address already in use[^\n]*?\bport\s+(\d{2,5})/i, // rails: ... bind(2) for "127.0.0.1" port 3000
    /bind on address \([^)]*?,\s*(\d{2,5})\)/i, // uvicorn: bind on address ('127.0.0.1', 8000)
  ];
  for (const pattern of fromOutput) {
    const port = Number(failure.output.match(pattern)?.[1]);
    if (port > 0 && port < 65536) return port;
  }
  const port = Number(failure.command.match(/(?:--port[= ]|-p\s*|:)(\d{2,5})\b/)?.[1]) || Number(failure.command.match(/\s(\d{4,5})(?:\s|$)/)?.[1]);
  return port > 0 && port < 65536 ? port : 0;
};

// 130: Ctrl+C, 148: Ctrl+Z; neither is a mistake to fix
const notFailures = new Set([0, 130, 148]);

export const findFixes = async (failure: Failure, commands: () => Iterable<string>, branches: () => Promise<string[]>): Promise<Fix[]> => {
  const words = failure.command.trim().split(/\s+/);
  if (words.length === 0 || !words[0] || notFailures.has(failure.exitCode)) return [];
  const fixes: Fix[] = [];
  for (const rule of rules) {
    try {
      fixes.push(...(await rule({ failure, words, commands, branches })));
    } catch {
      /* one broken rule does not stop the others */
    }
  }
  const seen = new Set<string>();
  return fixes
    .filter((f) => f.command !== failure.command.trim() || fixes.length > 1)
    .filter((f) => !seen.has(f.command) && seen.add(f.command))
    .slice(0, 3);
};
