// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import xterm from "@xterm/headless";

import { CommandManager } from "../../isterm/commandManager.js";
import { Shell } from "../../utils/shell.js";

const write = async (terminal: xterm.Terminal, data: string) => {
  await new Promise<void>((resolve) => terminal.write(data, resolve));
};

test("clears the public command snapshot as soon as a new prompt starts", async () => {
  const terminal = new xterm.Terminal({ allowProposedApi: true, rows: 10, cols: 80 });
  const manager = new CommandManager(terminal, Shell.Bash);

  manager.handlePromptStart();
  await write(terminal, "> ");
  manager.handlePromptEnd();
  await write(terminal, "abc");
  manager.termSync();
  expect(manager.getState().commandText).toBe("abc");
  const commandVersion = manager.getStateVersion();

  manager.handlePromptStart();

  expect(manager.getState().commandText).toBeUndefined();
  expect(manager.getStateVersion()).toBeGreaterThan(commandVersion);
});

test("does not track commands in the alternate buffer", async () => {
  const terminal = new xterm.Terminal({ allowProposedApi: true, rows: 10, cols: 80 });
  const manager = new CommandManager(terminal, Shell.Bash);

  manager.handlePromptStart();
  await write(terminal, "> ");
  manager.handlePromptEnd();
  await write(terminal, "abc");
  manager.termSync();
  expect(manager.getState().commandText).toBe("abc");
  const normalBufferVersion = manager.getStateVersion();

  await write(terminal, "\u001B[?1049h");
  await write(terminal, "alternate command");
  manager.handlePromptStart();
  manager.handlePromptEnd();
  manager.termSync();

  expect(terminal.buffer.active.type).toBe("alternate");
  expect(manager.getState()).toEqual({});
  expect(manager.getStateVersion()).toBeGreaterThan(normalBufferVersion);
  const alternateBufferVersion = manager.getStateVersion();

  manager.clearActiveCommand();

  await write(terminal, "\u001B[?1049l");
  manager.termSync();

  expect(manager.getState().commandText).toBe("abc");
  expect(manager.getStateVersion()).toBeGreaterThan(alternateBufferVersion);
});

test("keeps typed text before the cursor even when a highlighter paints it in a dull color", async () => {
  const terminal = new xterm.Terminal({ allowProposedApi: true, rows: 10, cols: 80 });
  const manager = new CommandManager(terminal, Shell.Zsh);

  manager.handlePromptStart();
  await write(terminal, "> ");
  manager.handlePromptEnd();
  // zsh-syntax-highlighting style output: a yellow builtin, then the argument in palette white (7)
  await write(terminal, "\u001B[33mcd\u001B[0m \u001B[37mwebsites/\u001B[0m");
  manager.termSync();

  expect(manager.getState().commandText).toBe("cd websites/");
});

test("still treats dull text after the cursor as an autosuggestion", async () => {
  const terminal = new xterm.Terminal({ allowProposedApi: true, rows: 10, cols: 80 });
  const manager = new CommandManager(terminal, Shell.Zsh);

  manager.handlePromptStart();
  await write(terminal, "> ");
  manager.handlePromptEnd();
  // zsh-autosuggestions style: typed "cd w", ghost "ebsites/" in palette 8, cursor moved back after "w"
  await write(terminal, "cd w\u001B[90mebsites/\u001B[0m\u001B[8D");
  manager.termSync();

  expect(manager.getState().commandText).toBe("cd w");
});
