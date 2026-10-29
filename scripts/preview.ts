// Renders the dropdown for a few commands into ANSI so it can be previewed outside a live terminal.
import { getSuggestions, loadLocalSpecsSet } from "../src/runtime/runtime.js";
import { SuggestionManager } from "../src/ui/suggestionManager.js";
import { Shell } from "../src/utils/shell.js";
import type { ISTerm } from "../src/isterm/pty.js";

const cwd = process.argv[2];
const commands = process.argv.slice(3);
await loadLocalSpecsSet();
const prompt = "➜ turbo-cloned git:(DEVIC-15129) ✗ ";
for (const commandText of commands) {
  const terminal = {
    cwd,
    cols: 100,
    getCommandState: () => ({ commandText, cursorTerminated: true, hasOutput: false }),
    getCursorState: () => ({ cursorX: 0 }),
    clearCommand: () => {},
    write: () => {},
  } as unknown as ISTerm;
  const manager = new SuggestionManager(terminal, Shell.Zsh, Promise.resolve({ getSuggestions }));
  await manager.exec();
  const cursorX = [...(prompt + commandText)].length;
  const rows = manager.render("below", cursorX);
  console.log(`@@ ${commandText}`);
  console.log(prompt + commandText);
  for (const row of rows) console.log(" ".repeat(row.startX) + row.data);
}
process.exit(0);
