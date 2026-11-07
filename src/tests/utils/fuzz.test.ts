// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// Thousands of random keys through the whole input path (bytes in, StdioProxy, InputRouter, SuggestionManager) into a
// fake shell. Whatever is typed, thint must never run a command by itself, never lose or change a byte while the list
// is closed, never throw, and Esc must always close the list.

import { jest } from "@jest/globals";
import type { ISTerm } from "../../isterm/pty.js";
import type { SuggestionBlob } from "../../runtime/model.js";
import { Shell } from "../../utils/shell.js";
import { escapeWait, StdioProxy } from "../../ui/stdioProxy.js";
import { InputRouter } from "../../ui/inputRouter.js";
import { SuggestionManager, type KeyPressEvent } from "../../ui/suggestionManager.js";

type Key = KeyPressEvent[1];

// a small deterministic random number generator, so a failing seed can be replayed
const random = (seed: number) => {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
};

const words = ["git", "checkout", "status", "main", "npm", "run", "dev", "docker", "compose", "up", "rel", "gti", "cd", "src/", "-f", "--force", "żółw"];
const vocabulary = ["git", "go", "grep", "gti", "checkout", "cherry-pick", "status", "stash", "main", "master", "develop", "run", "dev", "docker", "compose", "up", "down", "--force", "--follow", "-f", "rel"];

// what the shell does with the bytes it gets: a line editor that runs the line on a newline outside a paste
class FakeShell {
  line = "";
  received: string[] = [];
  executed: string[] = [];
  failureId = 0;
  recorded: string[] = [];
  lastFailure?: { id: number; command: string; exitCode: number; output: string; cwd: string };
  #pasting = false;

  write(data: string) {
    this.received.push(data);
    let rest = data;
    while (rest.length > 0) {
      if (rest.startsWith("\u001b[200~")) {
        this.#pasting = true;
        rest = rest.slice(6);
        continue;
      }
      if (rest.startsWith("\u001b[201~")) {
        this.#pasting = false;
        rest = rest.slice(6);
        continue;
      }
      const sequence = /^\u001b(\[[\d;:?]*[\x40-\x7e]|O.|.)?/u.exec(rest);
      if (sequence != null) {
        rest = rest.slice(sequence[0].length);
        continue;
      }
      const [char] = rest;
      rest = rest.slice(char.length);
      if ((char === "\r" || char === "\n") && !this.#pasting) this.run();
      else if (char === "\u007f" || char === "\b") this.line = [...this.line].slice(0, -1).join("");
      else if (char === "\u0015" || char === "\u0003") this.line = "";
      else if (char >= " " || char === "\t" || char === "\r" || char === "\n") this.line += char;
    }
  }

  run() {
    this.executed.push(this.line);
    if (this.line.startsWith("gti")) this.lastFailure = { id: ++this.failureId, command: this.line, exitCode: 127, output: "command not found: gti", cwd: "/" };
    this.line = "";
  }
}

const blobFor = (line: string): SuggestionBlob | undefined => {
  const token = line.split(" ").at(-1) ?? "";
  const matches = vocabulary.filter((name) => name.startsWith(token) && name !== token);
  if (line === "" || matches.length === 0) return undefined;
  return {
    suggestions: [
      ...matches.map((name, i) => ({ name, allNames: [name], icon: "*", priority: 60 - i })),
      ...(token.length > 0 && "rel".startsWith(token) ? [{ name: "release", allNames: ["release"], icon: "✂", priority: 70, snippet: "git tag {{version}} && git push {{remote:origin}}", kind: "snippet" as const }] : []),
    ],
    activeToken: { token, tokenLength: token.length, complete: false, isOption: token.startsWith("-") },
  };
};

const setup = () => {
  const shell = new FakeShell();
  const terminal = {
    cwd: "/",
    cols: 100,
    getCommandState: () => ({ commandText: shell.line, cursorTerminated: true, hasOutput: false, promptText: "$ " }),
    getCursorState: () => ({ cursorX: 0 }),
    getLastFailure: () => shell.lastFailure,
    write: (data: string) => shell.write(data),
    clearCommand: () => {},
    noop: () => {},
    isAlternateBuffer: () => false,
  } as unknown as ISTerm;
  const manager = new SuggestionManager(
    terminal,
    Shell.Zsh,
    Promise.resolve({
      getSuggestions: async (command: string) => blobFor(command) ?? { suggestions: [] },
      getFixes: async () => ({ mode: "fix" as const, suggestions: [{ name: "git status", allNames: ["git status"], icon: "↻", priority: 90, kind: "fix" as const, insertValue: "git status" }] }),
      explainCommand: async (command: string) => ({ mode: "explain" as const, suggestions: command.split(" ").map((w) => ({ name: w, allNames: [w], icon: "?", priority: 50, kind: "explain" as const })) }),
      reorderSuggestions: async () => {},
      recordExecutedCommand: async (command: string) => {
        shell.recorded.push(command);
      },
      rememberWholeCommand: async () => {},
    }),
  );
  const visible = () => manager.render("below", 0).length > 0;
  const router = new InputRouter({ term: terminal, suggestions: manager, shell: Shell.Zsh, hasVisibleSuggestions: visible, requestSuggestions: () => {} });
  return { shell, manager, router, visible };
};

const keys: [string, string][] = [
  ["Tab", "\t"],
  ["Shift+Tab", "\u001b[Z"],
  ["Enter", "\r"],
  ["Ctrl+J", "\n"],
  ["Esc", "\u001b"],
  ["Backspace", "\u007f"],
  ["Up", "\u001b[A"],
  ["Down", "\u001b[B"],
  ["Up, application mode", "\u001bOA"],
  ["Left", "\u001b[D"],
  ["Right", "\u001b[C"],
  ["Shift+Up", "\u001b[1;2A"],
  ["Shift+Down", "\u001b[1;2B"],
  ["Alt+Up", "\u001b\u001b[A"],
  ["Ctrl+Space", "\u0000"],
  ["Ctrl+G", "\u0007"],
  ["Ctrl+C", "\u0003"],
  ["Ctrl+U", "\u0015"],
  ["Home", "\u001b[H"],
  ["End", "\u001b[4~"],
  ["Alt+B", "\u001bb"],
  ["kitty Esc", "\u001b[27u"],
  ["kitty Ctrl+G", "\u001b[103;5u"],
  ["kitty release", "\u001b[97;1:3u"],
  ["modifyOtherKeys Ctrl+Space", "\u001b[27;5;32~"],
  ["F5", "\u001b[15~"],
  ["Option+C", "©"],
];

const isEnter = (key: Key) => key.name === "return" || key.name === "enter";
// keys thint takes for itself even with the list closed
const ownKey = (key: Key, line: string) => (key.ctrl && (key.name === "`" || key.name === "space")) || (key.ctrl && key.name === "g" && line.length > 0);

const runSeed = async (seed: number, steps: number) => {
  const next = random(seed);
  const pick = <T>(list: T[]): T => list[Math.floor(next() * list.length)];
  const ui = setup();
  const proxy = new StdioProxy();
  const failures: string[] = [];
  const log: string[] = [];
  let pasting = false;
  let escapes = 0;
  let withList = 0;

  proxy.onKeypress((value, key) => {
    const wasVisible = ui.visible();
    const line = ui.shell.line;
    const before = ui.shell.received.length;
    const executedBefore = ui.shell.executed.length;
    if (wasVisible) withList += 1;
    try {
      ui.router.handle(value, key);
    } catch (e) {
      failures.push(`threw on ${JSON.stringify(key.sequence)}: ${(e as Error).message}`);
      return;
    }
    if (key.name === "paste-start") pasting = true;
    const delta = ui.shell.received.slice(before).join("");
    if (ui.shell.executed.length > executedBefore && !(isEnter(key) && !pasting))
      failures.push(`ran ${JSON.stringify(ui.shell.executed.at(-1))} on ${JSON.stringify(key.sequence)}, not Enter`);
    if (pasting && delta !== key.sequence) failures.push(`paste changed ${JSON.stringify(key.sequence)} into ${JSON.stringify(delta)}`);
    if (!pasting && !wasVisible && !ownKey(key, line) && delta !== key.sequence)
      failures.push(`with the list closed ${JSON.stringify(key.sequence)} reached the shell as ${JSON.stringify(delta)}`);
    if (key.name === "escape" && wasVisible) {
      escapes += 1;
      if (ui.visible()) failures.push("the list stayed open after Esc");
    }
    if (key.name === "paste-end") pasting = false;
  });

  for (let step = 0; step < steps && failures.length === 0; step++) {
    const roll = next();
    let input: string;
    if (roll < 0.45) input = pick([...vocabulary, ...words]).slice(0, 1 + Math.floor(next() * 6));
    else if (roll < 0.55) input = " ";
    else if (roll < 0.9) input = pick(keys)[1];
    else if (roll < 0.95) {
      const text = Array.from({ length: 1 + Math.floor(next() * 4) }, () => pick([...words, "\r", "\t", " "])).join("");
      input = `\u001b[200~${text}\u001b[201~`;
    } else input = pick(["ą", "ż", "🚀", "漢"]);
    log.push(JSON.stringify(input));
    // sometimes the terminal cuts the bytes in two
    const bytes = Buffer.from(input);
    if (bytes.length > 1 && next() < 0.15) {
      const cut = 1 + Math.floor(next() * (bytes.length - 1));
      proxy.handleInput(bytes.subarray(0, cut));
      proxy.handleInput(bytes.subarray(cut));
    } else proxy.handleInput(bytes);
    if (input.endsWith("\u001b")) jest.advanceTimersByTime(escapeWait + 1);
    // the list catches up with the line most of the time, and sometimes lags behind it
    if (next() < 0.8) {
      ui.manager.invalidate();
      await ui.manager.exec();
    }
    if (next() < 0.02) ui.manager.render("below", 0, 1 + Math.floor(next() * 12)); // a resize to a tiny or tall terminal
  }
  proxy.dispose();
  await new Promise((resolve) => setImmediate(resolve));
  // the history learns only from commands that ran; a newline inside a paste runs nothing
  const ran = [...ui.shell.executed];
  for (const command of ui.shell.recorded) {
    const at = ran.indexOf(command);
    if (at === -1) failures.push(`recorded ${JSON.stringify(command)}, which never ran`);
    else ran.splice(at, 1);
  }
  return { failures, log: log.slice(-12), escapes, withList, executed: ui.shell.executed.length };
};

beforeEach(() => jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] }));
afterEach(() => jest.useRealTimers());

const seeds = Array.from({ length: 20 }, (_, i) => 1000 + i * 7919);

test.each(seeds)("seed %i: 600 random keys keep every rule", async (seed) => {
  const result = await runSeed(seed, 600);
  if (result.failures.length > 0) throw new Error(`${result.failures[0]}\nlast inputs: ${result.log.join(" ")}`);
  expect(result.failures).toEqual([]);
}, 60_000);

test("12 000 keys in one session do not grow the memory without bound", async () => {
  const start = process.memoryUsage().heapUsed;
  const result = await runSeed(424242, 12_000);
  expect(result.failures).toEqual([]);
  expect(result.escapes).toBeGreaterThan(30);
  expect(result.withList).toBeGreaterThan(2000);
  expect(result.executed).toBeGreaterThan(0);
  expect(process.memoryUsage().heapUsed - start).toBeLessThan(150 * 1024 * 1024);
}, 120_000);
