// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// When thint cannot start (its files missing, a home folder it cannot write), the startup lines must leave a working
// shell instead of closing the new tab. When the session ends normally, the tab closes as before.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import pty from "node-pty";

import { getShellConfig, Shell, startupFailedExitCode } from "../../utils/shell.js";

const has = (program: string) => {
  try {
    execFileSync("sh", ["-c", `command -v ${program}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

const unix = os.platform() !== "win32";
const shells = [
  { shell: Shell.Zsh, program: "zsh", rc: ".zshrc" },
  { shell: Shell.Bash, program: "bash", rc: ".bashrc" },
].filter((s) => unix && has(s.program));

const startTab = (program: string, home: string) =>
  new Promise<{ output: string; exited: boolean }>((resolve) => {
    const env = { ...process.env, HOME: home, ZDOTDIR: home, PS1: "$ ", PROMPT: "$ " } as Record<string, string>;
    delete env.ISTERM;
    delete env.VSCODE_RESOLVING_ENVIRONMENT;
    const term = pty.spawn(program, program === "bash" ? ["--noprofile", "--rcfile", path.join(home, ".bashrc"), "-i"] : ["-i"], {
      cols: 80,
      rows: 24,
      cwd: home,
      env,
    });
    let output = "";
    let exited = false;
    term.onData((data) => (output += data));
    term.onExit(() => (exited = true));
    setTimeout(() => term.write("echo still-$((40+2))\r"), 1500);
    setTimeout(() => {
      if (!exited) term.kill();
      resolve({ output, exited });
    }, 3000);
  });

const describeShells = shells.length > 0 ? describe.each(shells) : describe.skip.each([{ shell: Shell.Zsh, program: "zsh", rc: ".zshrc" }]);

describeShells("$program startup lines", ({ shell, program, rc }) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `thint-start-${program}-`));
  const launcher = path.join(home, "fake-thint");

  const setup = (exitCode: number) => {
    fs.writeFileSync(launcher, `#!/bin/sh\necho launched\nexit ${exitCode}\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(home, rc), `${getShellConfig(shell, launcher)}\necho rest-of-the-config\n`);
  };

  afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

  test("thint that could not start leaves a working shell", async () => {
    setup(startupFailedExitCode);
    const { output, exited } = await startTab(program, home);
    expect(output).toContain("launched");
    expect(output).toContain("rest-of-the-config");
    expect(output).toContain("still-42");
    expect(exited).toBe(false);
  }, 10_000);

  test.each([0, 1, 130])(
    "a session that ended with %i closes the tab as before",
    async (code) => {
      setup(code);
      const { output, exited } = await startTab(program, home);
      expect(output).toContain("launched");
      expect(output).not.toContain("still-42");
      expect(exited).toBe(true);
    },
    10_000,
  );
});
