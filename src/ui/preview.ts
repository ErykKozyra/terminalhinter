// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// Draws a sample dropdown with the current config, for `thint theme` and the `thint init` wizard.

import type { ISTerm } from "../isterm/pty.js";
import { Suggestion, SuggestionBlob } from "../runtime/model.js";
import chalk from "chalk";
import { Shell } from "../utils/shell.js";
import { SuggestionManager } from "./suggestionManager.js";

const sample = (name: string, icon: string, extra: Partial<Suggestion> = {}): Suggestion => ({ name, allNames: [name], icon, priority: 50, ...extra });

const sampleBlob: SuggestionBlob = {
  suggestions: [
    sample("checkout", "📦", { type: "subcommand", args: "[branch]", description: "Switch branches or restore working tree files" }),
    sample("cherry-pick", "📦", { type: "subcommand", args: "<commit>", description: "Apply the changes of existing commits" }),
    sample("chore/deps", "🌿", { description: "3 hours ago · bump turbo" }),
    sample("src", "📁", { type: "folder" }),
    sample("--force", "🔗", { type: "option", description: "Throw away local changes" }),
    sample("gco", "🔥", { description: "alias: git checkout" }),
  ],
  activeToken: { token: "ch", tokenLength: 2, complete: false, isOption: false },
  rootCommand: "git",
};

export const previewCommand = "git ch";

// rows of the dropdown as they appear under the prompt, already colored
export const renderPreview = async (cols = 80): Promise<string[]> => {
  const terminal = {
    cwd: process.cwd(),
    cols,
    getCommandState: () => ({ commandText: previewCommand, cursorTerminated: true, hasOutput: false }),
    getCursorState: () => ({ cursorX: 0 }),
    clearCommand: () => {},
    write: () => {},
  } as unknown as ISTerm;
  const manager = new SuggestionManager(terminal, Shell.Zsh, Promise.resolve({ getSuggestions: async () => sampleBlob }));
  await manager.exec();
  // a made-up prompt above the box, so it reads as an example and not as suggestions for what you are doing now
  const prompt = "  ➜ ";
  const rows = manager.render("below", prompt.length + previewCommand.length).map((row) => " ".repeat(row.startX) + row.data);
  return [chalk.dim("  Preview, as if you typed:"), prompt + previewCommand, ...rows];
};
