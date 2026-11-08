// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// What real terminals send for every key thint cares about, in every encoding they use, and what thint makes of it:
// thint's own keys must keep working, and every byte must reach the shell exactly as it came.

import type { ISTerm } from "../../isterm/pty.js";
import type { SuggestionBlob } from "../../runtime/model.js";
import { Shell } from "../../utils/shell.js";
import { escapeWait, StdioProxy } from "../../ui/stdioProxy.js";
import { InputRouter } from "../../ui/inputRouter.js";
import { SuggestionManager, type KeyPressEvent } from "../../ui/suggestionManager.js";

type Key = KeyPressEvent[1];
type Want = { name?: string; ctrl: boolean; shift: boolean; meta: boolean };
// "c" ctrl, "s" shift, "a" alt (readline calls it meta)
const k = (name: string | undefined, mods = ""): Want => ({ name, ctrl: mods.includes("c"), shift: mods.includes("s"), meta: mods.includes("a") });
// a key thint has no use for: only that it reaches the shell untouched, as one piece
const pass = null;
// text: one keypress per character
const TEXT = "text";
type Row = [label: string, sequence: string, want: Want | null | typeof TEXT];

const legacy: Row[] = [
  ["Tab", "\t", k("tab")],
  ["Shift+Tab", "\u001b[Z", k("tab", "s")],
  ["Enter", "\r", k("return")],
  ["Ctrl+J (line feed)", "\n", k("enter")],
  ["Esc", "\u001b", k("escape")],
  ["Backspace as ^?", "\u007f", k("backspace")],
  ["Backspace as ^H", "\b", k("backspace")],
  ["Up", "\u001b[A", k("up")],
  ["Down", "\u001b[B", k("down")],
  ["Right", "\u001b[C", k("right")],
  ["Left", "\u001b[D", k("left")],
  ["Up, application cursor mode", "\u001bOA", k("up")],
  ["Down, application cursor mode", "\u001bOB", k("down")],
  ["Right, application cursor mode", "\u001bOC", k("right")],
  ["Left, application cursor mode", "\u001bOD", k("left")],
  ["Shift+Up", "\u001b[1;2A", k("up", "s")],
  ["Shift+Down", "\u001b[1;2B", k("down", "s")],
  ["Alt+Up", "\u001b[1;3A", k("up", "a")],
  ["Alt+Down", "\u001b[1;3B", k("down", "a")],
  ["Alt+Up as Esc and the arrow", "\u001b\u001b[A", k("up", "a")],
  ["Alt+Down as Esc and the arrow", "\u001b\u001b[B", k("down", "a")],
  ["Ctrl+Up", "\u001b[1;5A", k("up", "c")],
  ["Ctrl+Left", "\u001b[1;5D", k("left", "c")],
  ["Ctrl+Right", "\u001b[1;5C", k("right", "c")],
  ["Alt+Left", "\u001b[1;3D", k("left", "a")],
  ["Ctrl+Space as NUL", "\u0000", k("`", "c")],
  ["Ctrl+G", "\u0007", k("g", "c")],
  ["Ctrl+C", "\u0003", k("c", "c")],
  ["Ctrl+U", "\u0015", k("u", "c")],
  ["Ctrl+A", "\u0001", k("a", "c")],
  ["Ctrl+E", "\u0005", k("e", "c")],
  ["Ctrl+R", "\u0012", k("r", "c")],
  ["Ctrl+W", "\u0017", k("w", "c")],
  ["Ctrl+D", "\u0004", k("d", "c")],
  ["Ctrl+L", "\u000c", k("l", "c")],
  ["Home as CSI H", "\u001b[H", k("home")],
  ["Home as SS3 H", "\u001bOH", k("home")],
  ["Home as CSI 1~", "\u001b[1~", k("home")],
  ["Home as CSI 7~", "\u001b[7~", k("home")],
  ["End as CSI F", "\u001b[F", k("end")],
  ["End as SS3 F", "\u001bOF", k("end")],
  ["End as CSI 4~", "\u001b[4~", k("end")],
  ["End as CSI 8~", "\u001b[8~", k("end")],
  ["Delete", "\u001b[3~", k("delete")],
  ["Ctrl+Delete", "\u001b[3;5~", k("delete", "c")],
  ["Insert", "\u001b[2~", k("insert")],
  ["Page Up", "\u001b[5~", k("pageup")],
  ["Page Down", "\u001b[6~", k("pagedown")],
  ["F1", "\u001bOP", k("f1")],
  ["F5", "\u001b[15~", k("f5")],
  ["F12", "\u001b[24~", k("f12")],
  ["Alt+B (word back)", "\u001bb", k("b", "a")],
  ["Alt+F (word forward)", "\u001bf", k("f", "a")],
  ["Alt+.", "\u001b.", pass],
  ["Alt+Backspace", "\u001b\u007f", k("backspace", "a")],
  ["Option+C without Meta on macOS", "©", TEXT],
  ["Option+A without Meta on macOS", "å", TEXT],
  ["Option+D without Meta on macOS", "∂", TEXT],
  ["Option+L without Meta on macOS", "¬", TEXT],
  ["Polish lower case", "ąćęłńóśźż", TEXT],
  ["Polish upper case", "ĄĆĘŁŃÓŚŹŻ", TEXT],
  ["German and French", "äöüßéèçœ", TEXT],
  ["Cyrillic", "привет", TEXT],
  ["CJK", "漢字かな", TEXT],
  ["emoji", "🚀", TEXT],
  ["emoji with a skin tone", "👍🏽", TEXT],
  ["emoji joined into a family", "👨‍👩‍👧", TEXT],
  ["flag", "🇵🇱", TEXT],
  ["e with a combining accent", "é", TEXT],
  ["focus in", "\u001b[I", pass],
  ["focus out", "\u001b[O", pass],
];

const rxvt: Row[] = [
  ["Shift+Up", "\u001b[a", k("up", "s")],
  ["Shift+Down", "\u001b[b", k("down", "s")],
  ["Ctrl+Up", "\u001bOa", k("up", "c")],
  ["Ctrl+Down", "\u001bOb", k("down", "c")],
  ["Home", "\u001b[7~", k("home")],
  ["End", "\u001b[8~", k("end")],
];

// xterm modifyOtherKeys 1 changes only the keys that are ambiguous otherwise
const modifyOtherKeys1: Row[] = [
  ["Ctrl+Enter", "\u001b[27;5;13~", k("return", "c")],
  ["Shift+Enter", "\u001b[27;2;13~", k("return", "s")],
  ["Ctrl+Tab", "\u001b[27;5;9~", k("tab", "c")],
  ["Ctrl+Shift+Tab", "\u001b[27;6;9~", k("tab", "cs")],
  ["Tab", "\t", k("tab")],
  ["Ctrl+G", "\u0007", k("g", "c")],
];

// modifyOtherKeys 2 is also the format tmux uses with extended-keys always
const modifyOtherKeys2: Row[] = [
  ["Ctrl+G", "\u001b[27;5;103~", k("g", "c")],
  ["Ctrl+Space", "\u001b[27;5;32~", k("space", "c")],
  ["Ctrl+C", "\u001b[27;5;99~", k("c", "c")],
  ["Ctrl+U", "\u001b[27;5;117~", k("u", "c")],
  ["Ctrl+I", "\u001b[27;5;105~", k("i", "c")],
  ["Ctrl+Shift+A", "\u001b[27;6;65~", k("a", "cs")],
  ["Alt+A", "\u001b[27;3;97~", k("a", "a")],
  ["Shift+Tab", "\u001b[27;2;9~", k("tab", "s")],
  ["Shift+Enter", "\u001b[27;2;13~", k("return", "s")],
  ["Ctrl+Enter", "\u001b[27;5;13~", k("return", "c")],
  ["Esc", "\u001b[27;1;27~", k("escape")],
  ["Ctrl+Backspace", "\u001b[27;5;127~", k("backspace", "c")],
];

// the kitty keyboard protocol with flag 1 (disambiguate escape codes); Enter, Tab and Backspace stay as they were
const kittyDisambiguate: Row[] = [
  ["Esc", "\u001b[27u", k("escape")],
  ["Ctrl+G", "\u001b[103;5u", k("g", "c")],
  ["Ctrl+Space", "\u001b[32;5u", k("space", "c")],
  ["Ctrl+C", "\u001b[99;5u", k("c", "c")],
  ["Ctrl+U", "\u001b[117;5u", k("u", "c")],
  ["Alt+B", "\u001b[98;3u", k("b", "a")],
  ["Ctrl+Shift+A", "\u001b[97;6u", k("a", "cs")],
  ["Shift+Enter", "\u001b[13;2u", k("return", "s")],
  ["Ctrl+Enter", "\u001b[13;5u", k("return", "c")],
  ["Alt+Enter", "\u001b[13;3u", k("return", "a")],
  ["Ctrl+Tab", "\u001b[9;5u", k("tab", "c")],
  ["Ctrl+Backspace", "\u001b[127;5u", k("backspace", "c")],
  ["Enter", "\r", k("return")],
  ["Tab", "\t", k("tab")],
  ["Shift+Tab", "\u001b[Z", k("tab", "s")],
  ["Backspace", "\u007f", k("backspace")],
  ["Up", "\u001b[A", k("up")],
  ["Shift+Up", "\u001b[1;2A", k("up", "s")],
  ["Super+A", "\u001b[97;9u", k("a")],
  ["Caps Lock on, A", "\u001b[97;65u", k("a")],
];

// flag 8: every key as an escape code
const kittyAllKeys: Row[] = [
  ["Enter", "\u001b[13u", k("return")],
  ["Tab", "\u001b[9u", k("tab")],
  ["Shift+Tab", "\u001b[9;2u", k("tab", "s")],
  ["Backspace", "\u001b[127u", k("backspace")],
  ["a", "\u001b[97u", k("a")],
  ["Shift+A", "\u001b[97;2u", k("a", "s")],
  ["Space", "\u001b[32u", k("space")],
  ["Left Shift alone", "\u001b[57441u", pass],
  ["Left Ctrl alone", "\u001b[57442;5u", pass],
  ["Caps Lock key", "\u001b[57358u", pass],
  ["Up", "\u001b[1;1A", k("up")],
];

// flag 2: press, repeat and release; flag 4 and 16: the shifted key and the text
const kittyEvents: Row[] = [
  ["a pressed", "\u001b[97;1:1u", k("a")],
  ["a repeated", "\u001b[97;1:2u", k("a")],
  ["a released", "\u001b[97;1:3u", pass],
  ["Esc released", "\u001b[27;1:3u", pass],
  ["Enter released", "\u001b[13;1:3u", pass],
  ["Ctrl+G released", "\u001b[103;5:3u", pass],
  ["Up released", "\u001b[1;1:3A", pass],
  ["Shift+Up released", "\u001b[1;2:3A", pass],
  ["Shift+A with its shifted key", "\u001b[97:65;2u", k("a", "s")],
  ["a with its text", "\u001b[97;1;97u", k("a")],
  ["Shift+A with shifted key and text", "\u001b[97:65;2;65u", k("a", "s")],
  ["ą with its text", "\u001b[261;1;261u", pass],
];

// win32-input-mode: Vk;Sc;Uc;Kd;Cs;Rc_ (only reaches thint if the outer terminal sends it without being asked)
const win32: Row[] = [
  ["a down", "\u001b[65;30;97;1;0;1_", pass],
  ["a up", "\u001b[65;30;97;0;0;1_", pass],
  ["Enter down", "\u001b[13;28;13;1;0;1_", pass],
  ["Esc down", "\u001b[27;1;27;1;0;1_", pass],
  ["Tab down", "\u001b[9;15;9;1;0;1_", pass],
  ["Ctrl+G down", "\u001b[71;34;7;1;8;1_", pass],
  ["Shift alone", "\u001b[16;42;0;1;16;1_", pass],
  ["ą down", "\u001b[65;30;261;1;0;1_", pass],
];

// what tmux, screen and zellij pass on with their default TERM (screen or tmux) settings
const multiplexers: Row[] = [
  ["tmux Home", "\u001b[1~", k("home")],
  ["tmux End", "\u001b[4~", k("end")],
  ["tmux Shift+Up", "\u001b[1;2A", k("up", "s")],
  ["tmux Up in application mode", "\u001bOA", k("up")],
  ["tmux Ctrl+G as csi-u (extended-keys-format csi-u)", "\u001b[103;5u", k("g", "c")],
  ["screen Home", "\u001b[1~", k("home")],
  ["screen End", "\u001b[4~", k("end")],
  ["screen Up in application mode", "\u001bOA", k("up")],
  ["zellij Esc", "\u001b", k("escape")],
  ["zellij Shift+Tab", "\u001b[Z", k("tab", "s")],
];

const pastes: Row[] = [
  ["bracketed paste", "\u001b[200~git status\u001b[201~", pass],
  ["bracketed paste with a newline", "\u001b[200~ls\rpwd\u001b[201~", pass],
  ["bracketed paste with a tab", "\u001b[200~a\tb\u001b[201~", pass],
  ["bracketed paste with Polish letters", "\u001b[200~zażółć\u001b[201~", pass],
];

const tables: [string, Row[]][] = [
  ["legacy xterm", legacy],
  ["rxvt", rxvt],
  ["modifyOtherKeys 1", modifyOtherKeys1],
  ["modifyOtherKeys 2", modifyOtherKeys2],
  ["kitty disambiguate", kittyDisambiguate],
  ["kitty all keys", kittyAllKeys],
  ["kitty events", kittyEvents],
  ["win32-input-mode", win32],
  ["multiplexers", multiplexers],
  ["paste", pastes],
];
const rows = tables.flatMap(([table, list]) => list.map(([label, sequence, want]) => [`${table}: ${label}`, sequence, want] as Row));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const feed = async (chunks: Buffer[]): Promise<Key[]> => {
  const proxy = new StdioProxy();
  const keys: Key[] = [];
  proxy.onKeypress((_value, key) => keys.push(key));
  for (const chunk of chunks) proxy.handleInput(chunk);
  await sleep(escapeWait + 10);
  proxy.dispose();
  return keys;
};

const check = (keys: Key[], sequence: string, want: Row[2]) => {
  // every byte reaches the shell as it came
  expect(keys.map((key) => key.sequence).join("")).toBe(sequence);
  if (want === TEXT) {
    expect(keys.length).toBeGreaterThan(0);
    return;
  }
  if (want === pass) {
    if (!sequence.startsWith("\u001b[200~")) expect(keys).toHaveLength(1);
    return;
  }
  expect(keys).toHaveLength(1);
  const [key] = keys;
  expect({ name: key.name, ctrl: !!key.ctrl, shift: !!key.shift, meta: !!key.meta }).toEqual(want);
};

describe("each key in one piece", () => {
  test.each(rows)("%s", async (_label, sequence, want) => {
    check(await feed([Buffer.from(sequence)]), sequence, want);
  });
});

describe("each key cut in two at every byte", () => {
  test.each(rows.filter(([, sequence]) => Buffer.byteLength(sequence) > 1))("%s", async (_label, sequence, want) => {
    const bytes = Buffer.from(sequence);
    const whole = await feed([bytes]);
    for (let cut = 1; cut < bytes.length; cut++) {
      const keys = await feed([bytes.subarray(0, cut), bytes.subarray(cut)]);
      check(keys, sequence, want);
      expect(keys.map((key) => key.name)).toEqual(whole.map((key) => key.name));
    }
  });
});

// thint's own keys do their job in every encoding, with the list open
const branches: SuggestionBlob = {
  suggestions: ["main", "develop", "feature/login"].map((name, i) => ({ name, allNames: [name], icon: "*", priority: 60 - i })),
  activeToken: { token: "ma", tokenLength: 2, complete: false, isOption: false },
};

const setup = async (commandText = "git checkout ma") => {
  const written: string[] = [];
  let cleared = 0;
  const terminal = {
    cwd: process.cwd(),
    cols: 100,
    getCommandState: () => ({ commandText, cursorTerminated: true, hasOutput: false }),
    getCursorState: () => ({ cursorX: 0 }),
    write: (data: string) => written.push(data),
    clearCommand: () => (cleared += 1),
    noop: () => {},
    isAlternateBuffer: () => false,
  } as unknown as ISTerm;
  const manager = new SuggestionManager(terminal, Shell.Zsh, Promise.resolve({ getSuggestions: async () => branches, reorderSuggestions: async () => {} }));
  await manager.exec();
  const visible = () => manager.render("below", 0).length > 0;
  let refreshes = 0;
  const router = new InputRouter({
    term: terminal,
    suggestions: manager,
    shell: Shell.Zsh,
    hasVisibleSuggestions: visible,
    requestSuggestions: () => (refreshes += 1),
  });
  const press = async (sequence: string) => {
    const keys = await feed([Buffer.from(sequence)]);
    for (const key of keys) router.handle(key.sequence, key);
  };
  const selected = () =>
    manager
      .render("below", 0)
      .map((patch) => patch.data)
      .join("\n");
  return { written, cleared: () => cleared, visible, press, selected, manager, refreshes: () => refreshes };
};

const encodings = {
  tab: ["\t", "\u001b[9u"],
  enter: ["\r", "\u001b[13u"],
  escape: ["\u001b", "\u001b[27u", "\u001b[27;1;27~"],
  down: ["\u001b[B", "\u001bOB", "\u001b[1;1B"],
  ctrlSpace: ["\u0000", "\u001b[32;5u", "\u001b[27;5;32~"],
  ctrlG: ["\u0007", "\u001b[103;5u", "\u001b[27;5;103~"],
  shiftDown: ["\u001b[1;2B", "\u001b[b", "\u001b[1;3B", "\u001b\u001b[B"],
  ctrlC: ["\u0003", "\u001b[99;5u", "\u001b[27;5;99~"],
};

describe("thint's keys with the list open", () => {
  test.each(encodings.tab)("Tab %j accepts the selected entry", async (sequence) => {
    const ui = await setup();
    await ui.press(sequence);
    expect(ui.written).toEqual(["in "]); // "ma" was typed, the rest of main comes
  });

  test.each(encodings.enter)("Enter %j takes the selected entry", async (sequence) => {
    const ui = await setup();
    await ui.press(sequence);
    expect(ui.written).toEqual(["in "]);
  });

  test.each(encodings.escape)("Esc %j closes the list and sends nothing", async (sequence) => {
    const ui = await setup();
    await ui.press(sequence);
    expect(ui.visible()).toBe(false);
    expect(ui.written).toEqual([]);
  });

  test.each(encodings.down)("Down %j moves the selection and sends nothing", async (sequence) => {
    const ui = await setup();
    await ui.press(sequence);
    await ui.press("\t");
    expect(ui.written).toEqual(["\u007f\u007fdevelop "]);
  });

  test.each(encodings.ctrlSpace)("Ctrl+Space %j closes an open list", async (sequence) => {
    const ui = await setup();
    await ui.press(sequence);
    expect(ui.visible()).toBe(false);
    expect(ui.written).toEqual([]);
  });

  test.each(encodings.ctrlG)("Ctrl+G %j asks for the explanation and sends nothing", async (sequence) => {
    const ui = await setup();
    await ui.press(sequence);
    expect(ui.refreshes()).toBe(1);
    expect(ui.written).toEqual([]);
  });

  test.each(encodings.shiftDown)("Shift+Down or Alt+Down %j moves the entry, not the selection", async (sequence) => {
    const ui = await setup();
    await ui.press("\u001b[B"); // select develop
    await ui.press(sequence); // develop goes below feature/login
    await ui.press("\t");
    expect(ui.written).toEqual(["\u007f\u007fdevelop "]);
    const rendered = ui.selected();
    expect(rendered.indexOf("feature/login")).toBeLessThan(rendered.indexOf("develop"));
  });

  test.each(encodings.ctrlC)("Ctrl+C %j reaches the shell", async (sequence) => {
    const ui = await setup();
    await ui.press(sequence);
    expect(ui.written).toEqual([sequence]);
  });

  test.each([
    ["F5", "\u001b[15~"],
    ["a released", "\u001b[97;1:3u"],
    ["win32 a down", "\u001b[65;30;97;1;0;1_"],
    ["focus in", "\u001b[I"],
    ["Ctrl+Left", "\u001b[1;5D"],
    ["Option+C", "©"],
    ["ą", "ą"],
    ["emoji", "🚀"],
  ])("%s goes to the shell byte for byte", async (_label, sequence) => {
    const ui = await setup();
    await ui.press(sequence);
    expect(ui.written.join("")).toBe(sequence);
  });
});

describe("pastes", () => {
  test("a pasted newline does not take an entry from the open list", async () => {
    const ui = await setup();
    await ui.press("\u001b[200~\rls\u001b[201~");
    expect(ui.written.join("")).toBe("\u001b[200~\rls\u001b[201~");
    expect(ui.cleared()).toBe(0);
  });

  test("a pasted tab does not take an entry", async () => {
    const ui = await setup();
    await ui.press("\u001b[200~\tx\u001b[201~");
    expect(ui.written.join("")).toBe("\u001b[200~\tx\u001b[201~");
  });

  test("after a paste the old list cannot be taken with Tab", async () => {
    const ui = await setup();
    await ui.press("\u001b[200~in\u001b[201~");
    await ui.press("\t");
    expect(ui.written.join("")).toBe("\u001b[200~in\u001b[201~\t");
  });

  test("an arrow cut in two does not close the list or leave [A on the line", async () => {
    const ui = await setup();
    const proxy = new StdioProxy();
    const written: string[] = [];
    proxy.onKeypress((_v, key) => written.push(key.sequence));
    proxy.handleInput(Buffer.from("\u001b"));
    await sleep(2);
    proxy.handleInput(Buffer.from("[B"));
    await sleep(escapeWait + 10);
    expect(written).toEqual(["\u001b[B"]);
    expect(ui.visible()).toBe(true);
  });

  test("Ctrl+J runs the line as typed in zsh", async () => {
    const ui = await setup();
    await ui.press("\n");
    expect(ui.written).toEqual(["\n"]);
    expect(ui.cleared()).toBe(1);
  });
});
