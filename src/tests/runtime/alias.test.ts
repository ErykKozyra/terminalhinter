// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import { Shell } from "../../utils/shell";

const mockExecuteShellCommand = jest.fn();
const mockGetConfig = jest.fn();

jest.unstable_mockModule("../../runtime/utils.js", () => ({
  buildExecuteShellCommand: () => mockExecuteShellCommand,
  getShellWhitespaceEscapeChar: () => "\\",
}));

jest.unstable_mockModule("../../utils/config.js", () => ({
  getConfig: mockGetConfig,
}));

const { aliasExpand, loadAliases, getAliasNames, getAliasCommand, isShellFunction } = await import("../../runtime/alias.js");
const os = await import("node:os");
const fs = await import("node:fs");
const path = await import("node:path");

beforeEach(() => {
  jest.clearAllMocks();
});

describe("aliasExpand", () => {
  test("don't expand when aliases are disabled", async () => {
    mockGetConfig.mockReturnValue({ useAliases: false });
    mockExecuteShellCommand.mockReturnValue({
      stdout: `alias glo='git log --oneline'`,
      status: 0,
    });

    const { aliasExpand: aliasExpandDisabled, loadAliases: loadAliasesDisabled } = await import("../../runtime/alias.js");

    await loadAliasesDisabled(Shell.Bash);
    // Should return the original token unchanged since aliases are disabled
    expect(aliasExpandDisabled([{ token: "glo", complete: true, isOption: false, tokenLength: 3 }])).toMatchSnapshot();
  });

  test("expand on bash aliases", async () => {
    mockGetConfig.mockReturnValue({ useAliases: true });
    mockExecuteShellCommand.mockReturnValue({
      stdout: `alias glo='git log --oneline'
alias la='echo '\\''lo'\\'' '\\''la'\\'''
alias ls='ls --color=auto'`,
      status: 0,
    });

    await loadAliases(Shell.Bash);
    expect(aliasExpand([{ token: "glo", complete: false, isOption: false, tokenLength: 3 }])).toMatchSnapshot();
    expect(aliasExpand([{ token: "la", complete: true, isOption: false, tokenLength: 2 }])).toMatchSnapshot();
    expect(aliasExpand([{ token: "git", complete: true, isOption: false, tokenLength: 3 }])).toMatchSnapshot();
    expect(aliasExpand([{ token: "ls", complete: true, isOption: false, tokenLength: 2 }])).toMatchSnapshot();
  });

  test("expand on zsh aliases", async () => {
    mockGetConfig.mockReturnValue({ useAliases: true });
    mockExecuteShellCommand.mockReturnValue({
      stdout: `glo='git log --oneline'
la='echo '\\''lo'\\'' '\\''la'\\'''
ls='ls --color=auto'`,
      status: 0,
    });

    await loadAliases(Shell.Zsh);
    expect(aliasExpand([{ token: "glo", complete: false, isOption: false, tokenLength: 3 }])).toMatchSnapshot();
    expect(aliasExpand([{ token: "la", complete: true, isOption: false, tokenLength: 2 }])).toMatchSnapshot();
    expect(aliasExpand([{ token: "git", complete: true, isOption: false, tokenLength: 3 }])).toMatchSnapshot();
    expect(aliasExpand([{ token: "ls", complete: true, isOption: false, tokenLength: 2 }])).toMatchSnapshot();
  });

  test("your own zsh functions are listed next to aliases, framework functions are not", async () => {
    mockGetConfig.mockReturnValue({ useAliases: true });
    const home = os.homedir();
    mockExecuteShellCommand.mockReturnValue({
      stdout: `gst='git status'
--- thint functions ---
mkcd\t${home}/.zshrc
_private\t${home}/.zshrc
git_prompt_info\t${home}/.oh-my-zsh/lib/git.zsh
compinit\t/usr/share/zsh/functions/compinit
deploy\t${home}/.zsh/functions.zsh`,
      status: 0,
    });

    await loadAliases(Shell.Zsh);
    expect(getAliasNames()).toEqual(["deploy", "gst", "mkcd"]);
    expect(getAliasCommand("mkcd")).toBe("function from ~/.zshrc");
    expect(isShellFunction("mkcd")).toBe(true);
    // a function is offered but never expanded like an alias
    expect(aliasExpand([{ token: "mkcd", complete: true, isOption: false, tokenLength: 4 }])).toEqual([
      { token: "mkcd", complete: true, isOption: false, tokenLength: 4 },
    ]);
  });
});

describe("alias cache", () => {
  test("a fresh cache is used without starting a shell", async () => {
    mockGetConfig.mockReturnValue({ useAliases: true });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thint-alias-"));
    process.env.THINT_ALIAS_CACHE = path.join(dir, "aliases.json");
    mockExecuteShellCommand.mockReturnValue({ stdout: "gco='git checkout'", status: 0 });
    await loadAliases(Shell.Zsh);
    expect(mockExecuteShellCommand).toHaveBeenCalledTimes(1);
    mockExecuteShellCommand.mockClear();
    await loadAliases(Shell.Zsh);
    expect(mockExecuteShellCommand).not.toHaveBeenCalled();
    expect(getAliasNames()).toEqual(["gco"]);
    delete process.env.THINT_ALIAS_CACHE;
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
