// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// Puts the terminalhinter startup lines at the very top of the shell config, inside a marked block, so they can be
// found, replaced and removed later. Anything above them would load twice: once outside terminalhinter and once
// inside it.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getShellSourceCommand, Shell } from "./shell.js";

export const beginMark = "# >>> terminalhinter >>>";
export const endMark = "# <<< terminalhinter <<<";

export const blockShells = [Shell.Zsh, Shell.Bash, Shell.Fish];

export const profileFile = (shell: Shell, home = os.homedir()): string | undefined => {
  switch (shell) {
    case Shell.Zsh:
      return path.join(process.env.ZDOTDIR ?? home, ".zshrc");
    case Shell.Bash:
      return path.join(home, ".bashrc");
    case Shell.Fish:
      return path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"), "fish", "config.fish");
  }
};

// the folder holding the thint binary, when it runs as one (not through node)
const binaryFolder = (): string | undefined => {
  const name = path.basename(process.execPath);
  return name === "thint" || name === "terminalhinter" ? path.dirname(process.execPath) : undefined;
};

const shellPath = (folder: string, home: string) => (folder.startsWith(home + path.sep) ? "$HOME" + folder.slice(home.length) : folder);

export const startupBlock = (shell: Shell, folder = binaryFolder(), home = os.homedir()): string => {
  const lines = [beginMark];
  if (folder != null) {
    lines.push(shell === Shell.Fish ? `fish_add_path -g "${shellPath(folder, home)}"` : `export PATH="${shellPath(folder, home)}:$PATH"`);
  }
  lines.push(getShellSourceCommand(shell).trim(), endMark);
  return lines.join("\n") + "\n";
};

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// removes an earlier block and loose startup lines, then puts the block first
export const withStartupBlock = (text: string, block: string, shell: Shell): string => {
  let rest = text.replace(new RegExp(`^${escape(beginMark)}\\n[\\s\\S]*?^${escape(endMark)}\\n\\n?`, "gm"), "");
  rest = rest.replace(new RegExp(`^.*(?:inshellisense|terminalhinter)/init/${shell}.*\\n?`, "gm"), "");
  rest = rest.replace(/^\n+/, "");
  return block + (rest.length > 0 ? "\n" + rest : "");
};

export const installStartupBlock = (shell: Shell, file = profileFile(shell)): { file: string; backup?: string } => {
  if (file == null) throw new Error(`terminalhinter cannot edit the config of ${shell} for you`);
  const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  let backup: string | undefined;
  if (before.length > 0) {
    backup = file + ".before-terminalhinter";
    if (!fs.existsSync(backup)) fs.writeFileSync(backup, before);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, withStartupBlock(before, startupBlock(shell), shell));
  return { file, backup };
};
