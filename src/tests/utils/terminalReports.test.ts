// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// fish 4 asks the terminal for its cursor position, device attributes and background color at every prompt. The
// answers come back on stdin, sometimes in pieces; they must reach the shell whole and never count as typing, or a fix
// shown after a failed command would be treated as out of date and Tab would go to the shell instead.

import { escapeWait, StdioProxy } from "../../ui/stdioProxy.js";
import { isTerminalReport, type KeyPressEvent } from "../../ui/suggestionManager.js";

type Key = KeyPressEvent[1];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const feed = async (chunks: string[]): Promise<Key[]> => {
  const proxy = new StdioProxy();
  const keys: Key[] = [];
  proxy.onKeypress((_value, key) => keys.push(key));
  for (const chunk of chunks) proxy.handleInput(Buffer.from(chunk));
  await sleep(escapeWait + 10);
  proxy.dispose();
  return keys;
};

const reports: [string, string][] = [
  ["device attributes", "\u001b[?1;2c"],
  ["device attributes, VT220 style", "\u001b[?62;22;52c"],
  ["secondary device attributes", "\u001b[>1;10;0c"],
  ["status", "\u001b[0n"],
  ["mode report", "\u001b[?2026;2$y"],
  ["kitty keyboard flags", "\u001b[?1u"],
  ["background color, BEL", "\u001b]11;rgb:1e1e/1e1e/2e2e\u0007"],
  ["background color, ST", "\u001b]11;rgb:1e1e/1e1e/2e2e\u001b\\"],
  ["XTGETTCAP", "\u001bP1+r544e=787465726d\u001b\\"],
  ["XTVERSION", "\u001bP>|WezTerm 20240203\u001b\\"],
];

const splits = (s: string): [string, string[]][] => [
  ["whole", [s]],
  ...Array.from({ length: s.length - 1 }, (_, i) => [`cut after ${i + 1}`, [s.slice(0, i + 1), s.slice(i + 1)]] as [string, string[]]),
  ["byte by byte", [...s]],
];

const cases = reports.flatMap(([label, s]) => splits(s).map(([how, chunks]) => [`${label}, ${how}`, s, chunks] as const));

test.each(cases)("%s arrives as one report", async (_label, sequence, chunks) => {
  const keys = await feed([...chunks]);
  expect(keys.map((k) => k.sequence)).toEqual([sequence]);
  expect(isTerminalReport(keys[0].sequence)).toBe(true);
});

test.each([
  ["typing after it", ["\u001b[?1;2c", "ls"], ["\u001b[?1;2c", "l", "s"]],
  ["typing before it", ["gi", "\u001b[0n", "t"], ["g", "i", "\u001b[0n", "t"]],
  ["an arrow next to it", ["\u001b[A\u001b]11;rgb:0/0/0\u0007"], ["\u001b[A", "\u001b]11;rgb:0/0/0\u0007"]],
] as const)("keys around a report stay keys: %s", async (_label, chunks, want) => {
  const keys = await feed([...chunks]);
  expect(keys.map((k) => k.sequence)).toEqual(want);
});

test.each([
  ["Alt+P", "\u001bP"],
  ["Alt+]", "\u001b]"],
  ["Alt+_", "\u001b_"],
] as const)("%s is not held back as the start of a report", async (_label, sequence) => {
  const keys = await feed([sequence, "x"]);
  expect(keys.map((k) => k.sequence).join("")).toBe(`${sequence}x`);
  expect(keys.some((k) => isTerminalReport(k.sequence))).toBe(false);
});

test.each(["\u001b[A", "\u001b[1;2B", "\u001b[Z", "\t", "a", "\u001b[13;2u", "\u001b[200~"])("a key is never a report: %j", (sequence) => {
  expect(isTerminalReport(sequence)).toBe(false);
});

// termenv (ollama, gh, glow) asks for the background color and then for the cursor position as a marker; the terminal
// answers in that order. If the cursor answer reached the program first, it took the color as not supported, turned
// echo back on, and the late color answer was printed and typed into the next prompt.
const color = "\u001b]11;rgb:1e1e/1e1e/1e1e\u0007";
const cursor = "\u001b[12;1R";
test.each([
  ["one chunk", [color + cursor]],
  ["two chunks", [color, cursor]],
  ["cut inside the color", [color.slice(0, 9), color.slice(9) + cursor]],
] as const)("a color answer and a cursor answer keep their order: %s", async (_label, chunks) => {
  const order: string[] = [];
  const proxy = new StdioProxy({ onCursorPositionReport: (data) => order.push(data) });
  proxy.onKeypress((_value, key) => order.push(key.sequence));
  for (const chunk of chunks) proxy.handleInput(Buffer.from(chunk));
  await sleep(escapeWait + 10);
  proxy.dispose();
  expect(order).toEqual([color, cursor]);
});

test("a cursor answer followed by Esc: the answer goes on, Esc is still the Esc key", async () => {
  const order: string[] = [];
  const proxy = new StdioProxy({ onCursorPositionReport: (data) => order.push(data) });
  proxy.onKeypress((_value, key) => order.push(`${key.name}:${key.sequence}`));
  proxy.handleInput(Buffer.from(cursor + "\u001b"));
  await sleep(escapeWait + 10);
  proxy.dispose();
  expect(order).toEqual([cursor, "escape:\u001b"]);
});
