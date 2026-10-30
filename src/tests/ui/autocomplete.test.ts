// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import { terminalSnapshot } from "@microsoft/tui-test/test";
import type { TuiTest } from "@microsoft/tui-test/test";
import { closeSession, configs, expectPrompt, expectText, returnChar, startSession } from "./helpers";

// selection bar of the default theme (src/ui/theme.ts)
const accent = "#2f5fd0";

jest.retryTimes(2, { logErrorsBeforeRetry: true });

describe("resize recovery", () => {
  let terminal: TuiTest;
  beforeEach(async () => {
    terminal = await startSession({ label: "bash-resize", shell: "bash", env: { BASH_SILENCE_DEPRECATION_WARNING: "1" } }, ["-T", "-s", "bash"]);
  });
  afterEach(async () => {
    await closeSession(terminal);
  });

  test("restores input and suggestions after becoming too narrow", async () => {
    await terminal.type("git st");
    await expectText(terminal, "stage");
    await terminal.waitIdle();
    const initialView = terminalSnapshot(await terminal.text());
    expect(initialView).toMatchSnapshot("initial 80 column view");

    await terminal.resize(40, 30);
    await terminal.waitIdle();
    expect(terminalSnapshot(await terminal.text())).toMatchSnapshot("40 column view");

    await terminal.resize(21, 30);
    await terminal.waitIdle();
    expect(terminalSnapshot(await terminal.text())).toMatchSnapshot("21 column view");

    await terminal.resize(80, 30);
    await terminal.waitIdle();
    await expectText(terminal, "stage");
    const restoredView = terminalSnapshot(await terminal.text());
    expect(restoredView).toMatchSnapshot("restored 80 column view");
    expect(restoredView).toBe(initialView);
  });
});

configs.map((config) => {
  const rc = returnChar(config.shell);
  const args = ["-V", "-T", "-s", config.shell];
  describe(`[${config.label}]`, () => {
    let terminal: TuiTest;
    beforeEach(async () => {
      terminal = await startSession(config, args);
    });
    afterEach(async () => {
      await closeSession(terminal);
    });

    test("basic git suggestions", async () => {
      await terminal.type("git ");

      await expectText(terminal, "blame", { strict: false });
      await expectText(terminal, "╭", { strict: false });
    });

    test("nothing is selected right after a space", async () => {
      await terminal.type("git ");

      await expectText(terminal, "blame", { strict: false });
      await terminal.waitIdle();
      await expectText(terminal, "blame", { strict: false, bg: accent, not: true });
    });

    test("down selects the first entry, typing a word selects its first match", async () => {
      await terminal.type("git che");

      await expectText(terminal, "checkout", { strict: false, bg: accent });
      await terminal.press("Down");
      await expectText(terminal, "cherry", { strict: false, bg: accent });
    });

    test("move cursor backwards to hide suggestions", async () => {
      await terminal.type("git ");

      await expectText(terminal, "blame", { strict: false });

      await terminal.press("Left");
      await expectText(terminal, "blame", { strict: false, not: true });
    });

    test("scrolling keeps the selection visible", async () => {
      await terminal.type("git ");

      await expectText(terminal, "blame", { strict: false });
      await terminal.waitIdle();
      await terminal.press("Down", "Down", "Down", "Down", "Down", "Down", "Down", "Down");

      await expectText(terminal, "8/", { strict: false });
    });

    // excluding cmd since it doesn't support CWD tracking
    (config.shell !== "cmd" ? test : test.skip)("folders are listed after cd", async () => {
      await terminal.type("cd sr");

      await expectText(terminal, "src/", { strict: false });
    });

    test("tab completion", async () => {
      await terminal.type("git chec");

      await expectText(terminal, "checkout", { strict: false });
      await terminal.press("Tab");

      await expectText(terminal, "git checkout ", { strict: false });
    });

    test("backspacing after accepting tab completion", async () => {
      await terminal.type("git chec");

      await expectText(terminal, "checkout", { strict: false });
      await terminal.press("Tab");
      await expectText(terminal, "git checkout ", { strict: false });
      await terminal.press("Backspace", "Backspace", "Backspace", "Backspace", "Backspace");

      await expectText(terminal, "checkout", { strict: false, bg: accent });
    });

    test("ui on bottom of the screen", async () => {
      await terminal.resize(80, 10);
      await terminal.write(rc.repeat(10));
      await expectPrompt(terminal);

      await terminal.type("git ");
      await expectText(terminal, "blame", { strict: false });
    });

    test("command detection after command execution", async () => {
      await terminal.write(`echo "hello"${rc}`);
      await expectText(terminal, "hello", { strict: false });
      await expectPrompt(terminal);

      await terminal.type("git ");
      await expectText(terminal, "blame", { strict: false });
    });

    test("suggestions clear after command execution", async () => {
      await terminal.type("git ");
      await expectText(terminal, "blame", { strict: false });

      await terminal.write(rc);
      await expectText(terminal, "blame", { strict: false, not: true });
    });

    test("cursor-position reports are not treated as input", async () => {
      await terminal.write("\u001B[2;7R");
      await terminal.waitIdle();
      await expectText(terminal, "[2;7R", { not: true });

      await terminal.type("git ");
      await expectText(terminal, "blame", { strict: false });
    });

    test("thint suggests its own commands", async () => {
      await terminal.type("thint ");
      await expectText(terminal, "theme", { strict: false });
    });

    test("proper overflow truncation in command", async () => {
      await terminal.resize(40, 30);
      await terminal.type("git checko");
      await expectText(terminal, "…", { strict: false });
    });
  });
});
