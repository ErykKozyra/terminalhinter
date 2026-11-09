// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { applyMigration, planMigration, withoutTheirLines } from "../../utils/migrate.js";

const kiroMacPre = [
  "# Kiro CLI pre block. Keep at the top of this file.",
  '[[ -f "${HOME}/Library/Application Support/kiro-cli/shell/zshrc.pre.zsh" ]] && builtin source "${HOME}/Library/Application Support/kiro-cli/shell/zshrc.pre.zsh"',
];
const kiroMacPost = [
  "# Kiro CLI post block. Keep at the bottom of this file.",
  '[[ -f "${HOME}/Library/Application Support/kiro-cli/shell/zshrc.post.zsh" ]] && builtin source "${HOME}/Library/Application Support/kiro-cli/shell/zshrc.post.zsh"',
];
const kiroLinux = [
  "# Kiro CLI pre block. Keep at the top of this file.",
  '[[ -f "${HOME}/.local/share/kiro-cli/shell/bashrc.pre.bash" ]] && builtin source "${HOME}/.local/share/kiro-cli/shell/bashrc.pre.bash"',
];
const qMac = [
  "# Amazon Q pre block. Keep at the top of this file.",
  '[[ -f "${HOME}/Library/Application Support/amazon-q/shell/zshrc.pre.zsh" ]] && builtin source "${HOME}/Library/Application Support/amazon-q/shell/zshrc.pre.zsh"',
];
const qBash = [
  "# Amazon Q post block. Keep at the bottom of this file.",
  '[[ -f "${HOME}/Library/Application Support/amazon-q/shell/bashrc.post.bash" ]] && builtin source "${HOME}/Library/Application Support/amazon-q/shell/bashrc.post.bash"',
];
const qFish = [
  "# Amazon Q pre block. Keep at the top of this file.",
  "test -f ~/.local/share/amazon-q/shell/config.fish.pre.fish; and builtin source ~/.local/share/amazon-q/shell/config.fish.pre.fish",
];
const cw = [
  "# CodeWhisperer pre block. Keep at the top of this file.",
  '[[ -f "${HOME}/Library/Application Support/codewhisperer/shell/zshrc.pre.zsh" ]] && builtin source "${HOME}/Library/Application Support/codewhisperer/shell/zshrc.pre.zsh"',
];
const figNew = [
  "# Fig pre block. Keep at the top of this file.",
  '[[ -f "$HOME/.fig/shell/zshrc.pre.zsh" ]] && builtin source "$HOME/.fig/shell/zshrc.pre.zsh"',
];
const figOld = [
  "#### FIG ENV VARIABLES ####",
  "# Please make sure this block is at the start of this file.",
  "[ -s ~/.fig/shell/pre.sh ] && source ~/.fig/shell/pre.sh",
  "#### END FIG ENV VARIABLES ####",
];
const figOldEnd = [
  "#### FIG ENV VARIABLES ####",
  "# Please make sure this block is at the end of this file.",
  "[ -s ~/.fig/fig.sh ] && source ~/.fig/fig.sh",
  "#### END FIG ENV VARIABLES ####",
];

const mine = ["export PATH=$HOME/bin:$PATH", "alias gs='git status'", 'eval "$(starship init zsh)"', "source ~/.zsh/plugins.zsh", "# my notes"];

// [name, file text, lines that must go, lines that must stay]
const files: [string, string[], string[], string[]][] = [
  ["Kiro on a Mac, both blocks", [...kiroMacPre, ...mine, ...kiroMacPost], [...kiroMacPre, ...kiroMacPost], mine],
  ["Kiro on Linux", [...kiroLinux, ...mine], kiroLinux, mine],
  ["Amazon Q zsh", [...qMac, ...mine], qMac, mine],
  ["Amazon Q bash", [...mine, ...qBash], qBash, mine],
  ["Amazon Q fish", [...qFish, "set -gx EDITOR vim"], qFish, ["set -gx EDITOR vim"]],
  ["CodeWhisperer", [...cw, ...mine], cw, mine],
  ["Fig, newer", [...figNew, ...mine], figNew, mine],
  ["Fig, the first versions", [...figOld, ...mine, ...figOldEnd], [...figOld, ...figOldEnd], mine],
  [
    "kiro-cli init lines",
    ['eval "$(kiro-cli init zsh pre --rcfile zshrc)"', ...mine, 'eval "$(kiro-cli init zsh post --rcfile zshrc)"'],
    ['eval "$(kiro-cli init zsh pre --rcfile zshrc)"', 'eval "$(kiro-cli init zsh post --rcfile zshrc)"'],
    mine,
  ],
  ["q init", ['eval "$(q init zsh pre)"', ...mine], ['eval "$(q init zsh pre)"'], mine],
  ["fig init piped", ["fig init zsh pre | source", ...mine], ["fig init zsh pre | source"], mine],
  ["already clean", mine, [], mine],
  ["empty", [""], [], []],
  [
    "someone else's eval stays",
    ['eval "$(zoxide init zsh)"', 'eval "$(fnm env)"', 'eval "$(mise activate zsh)"'],
    [],
    ['eval "$(zoxide init zsh)"', 'eval "$(fnm env)"', 'eval "$(mise activate zsh)"'],
  ],
  [
    "a PATH line that mentions kiro-cli stays",
    ['export PATH="$HOME/.local/share/kiro-cli/bin:$PATH"'],
    [],
    ['export PATH="$HOME/.local/share/kiro-cli/bin:$PATH"'],
  ],
  [
    "terminalhinter's own lines stay",
    ['[[ -o interactive ]] && [[ -z "$ISTERM" ]] && exec thint -s zsh'],
    [],
    ['[[ -o interactive ]] && [[ -z "$ISTERM" ]] && exec thint -s zsh'],
  ],
];

describe("taking out their lines", () => {
  test.each(files)("%s", (_name, lines, gone, stay) => {
    const { text, removed } = withoutTheirLines(lines.join("\n"));
    expect(removed).toEqual(gone);
    for (const line of stay) expect(text.split("\n")).toContain(line);
    for (const line of gone) expect(text).not.toContain(line);
  });
  test.each(files)("%s, saved on Windows (CRLF)", (_name, lines, gone, stay) => {
    const { text, removed } = withoutTheirLines(lines.join("\r\n") + "\r\n");
    expect(removed).toEqual(gone);
    for (const line of stay) expect(text.split("\r\n")).toContain(line);
  });
  test.each(files)("%s, no newline at the end", (_name, lines, gone) => {
    expect(withoutTheirLines(lines.join("\n")).removed).toEqual(gone);
  });
  test("no run of empty lines left behind", () => {
    const { text } = withoutTheirLines(["a", "", ...kiroMacPre, "", "", "b"].join("\n"));
    expect(text).not.toMatch(/\n{3,}/);
  });
  test("running it twice changes nothing more", () => {
    const once = withoutTheirLines([...kiroMacPre, ...mine, ...kiroMacPost].join("\n")).text;
    expect(withoutTheirLines(once)).toEqual({ text: once, removed: [] });
  });
});

describe("planning and applying", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "thint-mig-"));
  afterAll(() => fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const write = (name: string, lines: string[]) => {
    const file = path.join(home, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, lines.join("\n") + "\n");
    return file;
  };
  test("only files with their lines are in the plan", () => {
    const zshrc = write(".zshrc", [...kiroMacPre, ...mine]);
    const bashrc = write(".bashrc", mine);
    const fish = write(".config/fish/config.fish", qFish);
    const missing = path.join(home, ".zprofile");
    const plan = planMigration([zshrc, bashrc, fish, missing]);
    expect(plan.map((c) => c.file)).toEqual([zshrc, fish]);
    expect(plan[0].removed).toEqual(kiroMacPre);
  });
  test("applying keeps a numbered copy each time", () => {
    const file = write(".zshenv", [...figNew, "export A=1"]);
    const first = applyMigration(planMigration([file]));
    expect(first[0].backup).toBe(`${file}.before-thint-migrate`);
    expect(fs.readFileSync(file, "utf8")).toBe("export A=1\n");
    expect(fs.readFileSync(first[0].backup!, "utf8")).toContain("Fig pre block");
    fs.writeFileSync(file, [...figNew, "export A=1"].join("\n"));
    const second = applyMigration(planMigration([file]));
    expect(second[0].backup).toBe(`${file}.before-thint-migrate.2`);
  });
  test("nothing to do, nothing written", () => {
    const file = write(".profile", mine);
    expect(planMigration([file])).toEqual([]);
    expect(fs.existsSync(`${file}.before-thint-migrate`)).toBe(false);
  });
});
