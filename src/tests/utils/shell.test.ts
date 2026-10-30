// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import os from "node:os";
import path from "node:path";
import process from "node:process";
import { getShellSourceCommand, hasLegacyShellConfig, Shell, shouldFlagLegacyResourcePlugin, zdotdir } from "../../utils/shell.js";

test("uses a process-specific ZDOTDIR", () => {
  expect(zdotdir).toBe(path.join(os.tmpdir(), `is-zsh-${process.pid}`));
});

describe("getShellSourceCommand", () => {
  test.each([
    [Shell.Bash, "~/.terminalhinter/init/bash/init.sh", "[ -f ~/.terminalhinter/init/bash/init.sh ] && source ~/.terminalhinter/init/bash/init.sh"],
    [
      Shell.Powershell,
      "~/.terminalhinter/init/powershell/init.ps1",
      "if ( Test-Path '~/.terminalhinter/init/powershell/init.ps1' -PathType Leaf ) { . ~/.terminalhinter/init/powershell/init.ps1 }",
    ],
    [
      Shell.Pwsh,
      "~/.terminalhinter/init/pwsh/init.ps1",
      "if ( Test-Path '~/.terminalhinter/init/pwsh/init.ps1' -PathType Leaf ) { . ~/.terminalhinter/init/pwsh/init.ps1 }",
    ],
    [Shell.Zsh, "~/.terminalhinter/init/zsh/init.zsh", "[[ -f ~/.terminalhinter/init/zsh/init.zsh ]] && source ~/.terminalhinter/init/zsh/init.zsh"],
    [Shell.Fish, "~/.terminalhinter/init/fish/init.fish", "test -f ~/.terminalhinter/init/fish/init.fish && source ~/.terminalhinter/init/fish/init.fish"],
    [
      Shell.Xonsh,
      "~/.terminalhinter/init/xonsh/init.xsh",
      'p"~/.terminalhinter/init/xonsh/init.xsh".exists() && source "~/.terminalhinter/init/xonsh/init.xsh"',
    ],
    [
      Shell.Nushell,
      "~/.terminalhinter/init/nu/init.nu",
      "if ( '~/.terminalhinter/init/nu/init.nu' | path exists ) { source ~/.terminalhinter/init/nu/init.nu }",
    ],
  ])("preserves the legacy %s command", (shell, initFilePath, expected) => {
    expect(getShellSourceCommand(shell, initFilePath)).toBe(expected);
  });

  test.each([
    [
      Shell.Bash,
      "/tmp/xdg home/terminalhinter/init/bash/init.sh",
      "[ -f '/tmp/xdg home/terminalhinter/init/bash/init.sh' ] && source '/tmp/xdg home/terminalhinter/init/bash/init.sh'",
    ],
    [
      Shell.Pwsh,
      "/tmp/xdg home/terminalhinter/init/pwsh/init.ps1",
      "if ( Test-Path '/tmp/xdg home/terminalhinter/init/pwsh/init.ps1' -PathType Leaf ) { . '/tmp/xdg home/terminalhinter/init/pwsh/init.ps1' }",
    ],
    [
      Shell.Zsh,
      "/tmp/xdg home/terminalhinter/init/zsh/init.zsh",
      "[[ -f '/tmp/xdg home/terminalhinter/init/zsh/init.zsh' ]] && source '/tmp/xdg home/terminalhinter/init/zsh/init.zsh'",
    ],
    [
      Shell.Fish,
      "/tmp/xdg home/terminalhinter/init/fish/init.fish",
      "test -f '/tmp/xdg home/terminalhinter/init/fish/init.fish' && source '/tmp/xdg home/terminalhinter/init/fish/init.fish'",
    ],
    [
      Shell.Xonsh,
      "/tmp/xdg home/terminalhinter/init/xonsh/init.xsh",
      'p"/tmp/xdg home/terminalhinter/init/xonsh/init.xsh".exists() && source "/tmp/xdg home/terminalhinter/init/xonsh/init.xsh"',
    ],
    [
      Shell.Nushell,
      "/tmp/xdg home/terminalhinter/init/nu/init.nu",
      'if ( "/tmp/xdg home/terminalhinter/init/nu/init.nu" | path exists ) { source "/tmp/xdg home/terminalhinter/init/nu/init.nu" }',
    ],
  ])("quotes an XDG path for %s", (shell, initFilePath, expected) => {
    expect(getShellSourceCommand(shell, initFilePath)).toBe(expected);
  });

  test("escapes shell-specific quote characters", () => {
    expect(getShellSourceCommand(Shell.Bash, "/tmp/user's config/init.sh")).toContain("'/tmp/user'\\''s config/init.sh'");
    expect(getShellSourceCommand(Shell.Pwsh, "/tmp/user's config/init.ps1")).toContain("'/tmp/user''s config/init.ps1'");
  });
});

describe("hasLegacyShellConfig", () => {
  test("detects the original shell plugin marker", () => {
    expect(hasLegacyShellConfig("# terminalhinter shell plugin", Shell.Zsh, false)).toBe(true);
  });

  test("detects the original generated plugin path", () => {
    expect(hasLegacyShellConfig("source ~/.terminalhinter/zsh/init.zsh", Shell.Zsh, false)).toBe(true);
  });

  test("detects the current path when it should be treated as legacy", () => {
    expect(hasLegacyShellConfig("source ~/.terminalhinter/init/zsh/init.zsh", Shell.Zsh, true)).toBe(true);
  });

  test("allows the current path while legacy resources remain current", () => {
    expect(hasLegacyShellConfig("source ~/.terminalhinter/init/zsh/init.zsh", Shell.Zsh, false)).toBe(false);
  });
});

describe("shouldFlagLegacyResourcePlugin", () => {
  test.each([
    ["legacy resources without an XDG config", true, false, false],
    ["migrated resources without an XDG config", false, false, true],
    ["legacy resources with an XDG config", true, true, true],
  ])("%s", (_case, usesLegacyResources, hasXdgConfig, expected) => {
    expect(shouldFlagLegacyResourcePlugin(usesLegacyResources, hasXdgConfig)).toBe(expected);
  });
});
