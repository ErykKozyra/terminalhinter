// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// The list failing must never stop keys from reaching the shell: not when looking for entries throws, not when the
// engine never starts, not when it answers with nonsense.

import type { ISTerm } from "../../isterm/pty.js";
import { Shell } from "../../utils/shell.js";
import { BatchScheduler } from "../../ui/batchScheduler.js";
import { InputRouter } from "../../ui/inputRouter.js";
import { StdioProxy } from "../../ui/stdioProxy.js";
import { SuggestionManager } from "../../ui/suggestionManager.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Runtime = any;

const session = (runtime: Runtime) => {
  let line = "";
  const received: string[] = [];
  const terminal = {
    cwd: "/",
    cols: 80,
    getCommandState: () => ({ commandText: line, cursorTerminated: true, hasOutput: false, promptText: "$ " }),
    getCursorState: () => ({ cursorX: 0 }),
    getLastFailure: () => ({ id: 1, command: "gti status", exitCode: 127, output: "", cwd: "/" }),
    write: (data: string) => {
      received.push(data);
      for (const char of data) {
        if (char === "\r") line = "";
        else if (char === "\u007f") line = line.slice(0, -1);
        else if (char >= " ") line += char;
      }
    },
    clearCommand: () => {},
    noop: () => {},
    isAlternateBuffer: () => false,
  } as unknown as ISTerm;
  const manager = new SuggestionManager(terminal, Shell.Bash, runtime);
  const errors: unknown[] = [];
  const scheduler = new BatchScheduler(
    async () => {
      await manager.exec();
    },
    (error) => errors.push(error),
  );
  const router = new InputRouter({
    term: terminal,
    suggestions: manager,
    shell: Shell.Bash,
    hasVisibleSuggestions: () => manager.render("below", 0).length > 0,
    requestSuggestions: () => scheduler.request(),
  });
  const proxy = new StdioProxy();
  proxy.onKeypress((value, key) => {
    router.handle(value, key);
    manager.invalidate();
    scheduler.request();
  });
  const type = async (text: string) => {
    for (const char of text) {
      proxy.handleInput(Buffer.from(char));
      await new Promise((resolve) => setImmediate(resolve));
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  };
  return { type, received, errors, manager, line: () => line };
};

const unhandled: unknown[] = [];
const onUnhandled = (e: unknown) => unhandled.push(e);
beforeAll(() => process.on("unhandledRejection", onUnhandled));
afterAll(() => process.off("unhandledRejection", onUnhandled));
beforeEach(() => (unhandled.length = 0));

test.each([
  ["looking for entries throws", { getSuggestions: async () => Promise.reject(new Error("engine broke")) }],
  [
    "looking for entries throws at once",
    {
      getSuggestions: (() => {
        throw new Error("engine broke");
      }) as never,
    },
  ],
  [
    "the fixes and the explanation throw",
    {
      getSuggestions: async () => ({ suggestions: [] }),
      getFixes: async () => Promise.reject(new Error("fixes broke")),
      explainCommand: async () => Promise.reject(new Error("explain broke")),
    },
  ],
  ["the answer is nonsense", { getSuggestions: async () => ({ suggestions: [null, { name: 3 }, { allNames: [] }] }) as never }],
  [
    "remembering commands throws",
    {
      getSuggestions: async () => ({ suggestions: [] }),
      recordExecutedCommand: () => {
        throw new Error("disk broke");
      },
      rememberWholeCommand: () => {
        throw new Error("disk broke");
      },
    },
  ],
])("when %s, every key still reaches the shell", async (_label, runtime) => {
  const ui = session(Promise.resolve(runtime));
  await ui.type("git checkout main\r");
  await ui.type("ls -la\u0007\r"); // Ctrl+G asks for the explanation
  await ui.type("\u0000pwd\r"); // Ctrl+Space on an empty line, then a command
  // everything but thint's own two keys
  expect(ui.received.join("")).toBe("git checkout main\rls -la\rpwd\r");
  expect(unhandled).toEqual([]);
});

test("when the engine never starts, every key still reaches the shell", async () => {
  const ui = session(Promise.reject(new Error("could not load the specs")));
  await ui.type("git status\r");
  await ui.type("npm run dev\r");
  expect(ui.received.join("")).toBe("git status\rnpm run dev\r");
  expect(unhandled).toEqual([]);
});
