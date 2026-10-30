// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// Kiro/Fig style navigation: Enter walks into folders, the ↪ entry runs the command,
// and nothing is preselected right after a space so Enter just executes.

import type { ISTerm } from "../../isterm/pty.js";
import type { SuggestionBlob } from "../../runtime/model.js";
import { Shell } from "../../utils/shell.js";
import { SuggestionManager } from "../../ui/suggestionManager.js";

const press = (name: string) => ({ name, sequence: name === "return" ? "\r" : name === "tab" ? "\t" : "", ctrl: false, shift: false });

const setup = (blob: SuggestionBlob) => {
  const writes: string[] = [];
  let cleared = 0;
  const terminal = {
    cwd: process.cwd(),
    cols: 100,
    getCommandState: () => ({ commandText: "cmd", cursorTerminated: true, hasOutput: false }),
    getCursorState: () => ({ cursorX: 0 }),
    write: (data: string) => writes.push(data),
    clearCommand: () => (cleared += 1),
  } as unknown as ISTerm;
  const manager = new SuggestionManager(terminal, Shell.Zsh, Promise.resolve({ getSuggestions: async () => blob }));
  return { manager, writes, cleared: () => cleared };
};

const folders = (...names: string[]) =>
  names.map((name) => ({ name, allNames: [name], icon: "📁", priority: 55, type: "folder" as const, insertValue: `websites/${name}/` }));

test("enter on a folder inserts it with a trailing slash instead of running the command", async () => {
  const { manager, writes, cleared } = setup({
    suggestions: [{ name: "websites", allNames: ["websites"], icon: "📁", priority: 55, type: "folder", insertValue: "websites/" }],
    activeToken: { token: "web", tokenLength: 3, complete: false, isOption: false },
  });
  await manager.exec();
  expect(manager.update(press("return"))).toBe(true);
  expect(writes).toEqual(["\u007F\u007F\u007Fwebsites/"]);
  expect(cleared()).toBe(0);
});

test("inside a folder the first entry is ↪ and enter on it runs the command", async () => {
  const { manager, writes, cleared } = setup({
    suggestions: folders("intercars.com.pl", "qservicetruck.eu"),
    activeToken: { token: "websites/", tokenLength: 9, complete: false, isOption: false, isPath: true, isPathComplete: true },
    isPathContext: true,
    rootCommand: "cd",
  });
  await manager.exec();
  const rendered = manager
    .render("below", 12)
    .map((p) => p.data)
    .join("\n");
  expect(rendered).toContain("↪");
  expect(rendered).toContain("Enter the current directory");
  expect(manager.update(press("return"))).toBe(false); // the keypress goes to the shell
  expect(writes).toEqual([]);
  expect(cleared()).toBe(1);
});

test("arrow down then enter walks one level deeper", async () => {
  const { manager, writes } = setup({
    suggestions: folders("intercars.com.pl", "qservicetruck.eu"),
    activeToken: { token: "websites/", tokenLength: 9, complete: false, isOption: false, isPath: true, isPathComplete: true },
    isPathContext: true,
    rootCommand: "cd",
  });
  await manager.exec();
  expect(manager.update(press("down"))).toBe(true);
  expect(manager.update(press("return"))).toBe(true);
  expect(writes.at(-1)).toBe("\u007F".repeat(9) + "websites/intercars.com.pl/");
});

test("after a space nothing is selected, so enter executes and up reaches shell history", async () => {
  const { manager, writes } = setup({
    suggestions: [{ name: "main", allNames: ["main"], icon: "📀", priority: 60 }],
  });
  await manager.exec();
  expect(manager.update(press("up"))).toBe(false);
  expect(manager.update(press("return"))).toBe(false);
  expect(writes).toEqual([]);
});

test("after a space, arrow down selects the first entry and enter accepts it", async () => {
  const { manager, writes } = setup({
    suggestions: [{ name: "main", allNames: ["main"], icon: "📀", priority: 60 }],
  });
  await manager.exec();
  expect(manager.update(press("down"))).toBe(true);
  expect(manager.update(press("return"))).toBe(true);
  expect(writes).toEqual(["main "]);
});

test("tab still completes the top entry, skipping ↪", async () => {
  const { manager, writes } = setup({
    suggestions: folders("intercars.com.pl"),
    activeToken: { token: "websites/", tokenLength: 9, complete: false, isOption: false, isPath: true, isPathComplete: true },
    isPathContext: true,
    rootCommand: "cd",
  });
  await manager.exec();
  expect(manager.update(press("tab"))).toBe(true);
  expect(writes.at(-1)).toBe("\u007F".repeat(9) + "websites/intercars.com.pl/");
});

test("enter on a fully typed word runs the command instead of re-inserting it", async () => {
  const { manager, writes } = setup({
    suggestions: [{ name: "status", allNames: ["status"], icon: "📦", priority: 50 }],
    activeToken: { token: "status", tokenLength: 6, complete: false, isOption: false },
  });
  await manager.exec();
  expect(manager.update(press("return"))).toBe(false);
  expect(writes).toEqual([]);
});

test("enter on a path that is already typed in full runs the command", async () => {
  const { manager, writes } = setup({
    suggestions: [
      {
        name: "shellIntegration-rc.zsh",
        allNames: ["shellIntegration-rc.zsh"],
        icon: "📄",
        priority: 55,
        type: "file",
        insertValue: "shell/shellIntegration-rc.zsh",
      },
    ],
    activeToken: { token: "shell/shellIntegration-rc.zsh", tokenLength: 29, complete: false, isOption: false, isPath: true },
  });
  await manager.exec();
  expect(manager.update(press("return"))).toBe(false);
  expect(writes).toEqual([]);
});

test("a lone dash runs the command, so git checkout - and cd - go back", async () => {
  const { manager, writes } = setup({
    suggestions: [{ name: "DEVIC-15145", allNames: ["DEVIC-15145"], icon: "📀", priority: 60 }],
    activeToken: { token: "-", tokenLength: 1, complete: false, isOption: true },
  });
  await manager.exec();
  expect(manager.update(press("return"))).toBe(false);
  expect(writes).toEqual([]);
});

test("after a lone dash, arrow down still picks from the list", async () => {
  const { manager, writes } = setup({
    suggestions: [{ name: "-b", allNames: ["-b"], icon: "🔗", priority: 45 }],
    activeToken: { token: "-", tokenLength: 1, complete: false, isOption: true },
  });
  await manager.exec();
  expect(manager.update(press("down"))).toBe(true);
  expect(manager.update(press("return"))).toBe(true);
  expect(writes).toEqual(["b "]);
});

test("up on an untouched list goes to shell history, after moving in it up stays in the list", async () => {
  const blob: SuggestionBlob = {
    suggestions: [
      { name: "status", allNames: ["status"], icon: "📦", priority: 50 },
      { name: "stash", allNames: ["stash"], icon: "📦", priority: 50 },
    ],
    activeToken: { token: "st", tokenLength: 2, complete: false, isOption: false },
  };
  const { manager } = setup(blob);
  await manager.exec();
  expect(manager.update(press("up"))).toBe(false);
  expect(manager.update(press("down"))).toBe(true);
  expect(manager.update(press("up"))).toBe(true);
  expect(manager.update(press("up"))).toBe(true);
});

test("a word typed in full whose only suggestion is itself shows no list", async () => {
  const { manager } = setup({
    suggestions: [{ name: "pwd", allNames: ["pwd"], icon: "📦", priority: 50 }],
    activeToken: { token: "pwd", tokenLength: 3, complete: false, isOption: false },
  });
  await manager.exec();
  expect(manager.render("below", 3)).toEqual([]);
  expect(manager.update(press("up"))).toBe(false);
  expect(manager.update(press("return"))).toBe(false);
});

test("in a short terminal the list shrinks to the free rows instead of disappearing", async () => {
  const names = ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"];
  const { manager } = setup({
    suggestions: names.map((name) => ({ name, allNames: [name], icon: "📦", priority: 50 })),
    activeToken: { token: "a", tokenLength: 1, complete: false, isOption: false },
  });
  await manager.exec();
  const rows = manager.render("below", 3, 8);
  expect(rows.length).toBeLessThanOrEqual(8);
  expect(rows.map((r) => r.data).join("\n")).toContain("1/8");
});

test("enter never inserts from a list made for older text", async () => {
  const writes: string[] = [];
  let commandText = "git checkout ";
  const terminal = {
    cwd: process.cwd(),
    cols: 100,
    getCommandState: () => ({ commandText, cursorTerminated: true, hasOutput: false }),
    getCursorState: () => ({ cursorX: 0 }),
    write: (data: string) => writes.push(data),
    clearCommand: () => {},
  } as unknown as ISTerm;
  const blob: SuggestionBlob = { suggestions: [{ name: "feature/login", allNames: ["feature/login"], icon: "🌿", priority: 50 }] };
  const manager = new SuggestionManager(terminal, Shell.Zsh, Promise.resolve({ getSuggestions: async () => blob }));
  await manager.exec();
  expect(manager.update(press("down"))).toBe(true);
  commandText = "git checkout fix/header"; // typed faster than the list refreshed
  expect(manager.update(press("return"))).toBe(false);
  expect(writes).toEqual([]);
});
