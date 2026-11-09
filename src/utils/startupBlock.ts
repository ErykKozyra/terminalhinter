// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// Puts the terminalhinter startup lines at the very top of the shell config, inside a marked block, so they can be
// found, replaced and removed later. Anything above them would load twice: once outside terminalhinter and once
// inside it.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import which from "which";

import { getShellSourceCommand, gitBashPath, Shell } from "./shell.js";

export const beginMark = "# >>> terminalhinter >>>";
export const endMark = "# <<< terminalhinter <<<";

export const blockShells = [Shell.Zsh, Shell.Bash, Shell.Fish, Shell.Pwsh, ...(process.platform === "win32" ? [Shell.Powershell] : [])];

// PowerShell knows its own profile best: Documents can sit in OneDrive or on another drive. Undefined when that
// PowerShell is not installed. Asked once per run, it takes a moment to start.
const powershellProfiles = new Map<Shell, string | undefined>();
const powershellProfile = (shell: Shell): string | undefined => {
  if (!powershellProfiles.has(shell)) powershellProfiles.set(shell, runPowershell(shell, "$PROFILE.CurrentUserCurrentHost") || undefined);
  return powershellProfiles.get(shell);
};

const powershellExe = (shell: Shell) => (shell === Shell.Pwsh ? "pwsh" : "powershell");
const runPowershell = (shell: Shell, command: string): string | undefined => {
  try {
    return execFileSync(powershellExe(shell), ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], {
      encoding: "utf8",
      timeout: 15_000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
};

// Windows PowerShell 5.1 comes with scripts turned off (Restricted): it then skips the profile, so the startup lines
// never run, and npm's thint.ps1 does not start either. AllSigned skips them too, they are not signed.
export const powershellBlocksScripts = (shell: Shell): string | undefined => {
  if (process.platform !== "win32" || (shell !== Shell.Pwsh && shell !== Shell.Powershell)) return;
  const policy = runPowershell(shell, "Get-ExecutionPolicy");
  return policy === "Restricted" || policy === "AllSigned" ? policy : undefined;
};
export const allowScriptsCommand = "Set-ExecutionPolicy -Scope CurrentUser RemoteSigned";
// RemoteSigned for this user only (what PowerShell 7 has from the start): scripts made on this computer run, ones from
// the internet need a signature. True when scripts run now; a policy set by the company wins over it.
export const allowPowershellScripts = (shell: Shell): boolean => {
  runPowershell(shell, `${allowScriptsCommand} -Force`);
  return powershellBlocksScripts(shell) == null;
};

export const profileFile = (shell: Shell, home = os.homedir()): string | undefined => {
  switch (shell) {
    case Shell.Zsh:
      return path.join(process.env.ZDOTDIR ?? home, ".zshrc");
    case Shell.Bash:
      return path.join(home, ".bashrc");
    case Shell.Fish:
      return path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"), "fish", "config.fish");
    case Shell.Pwsh:
    case Shell.Powershell:
      return powershellProfile(shell);
  }
};

// The other shells on this computer that can start terminalhinter too. On Windows: both PowerShells (Windows Terminal
// opens Windows PowerShell 5.1 unless told otherwise) and Git Bash. Elsewhere: a shell that is installed and already
// has its config, so nobody gets a .bashrc for a bash they never open.
export const otherShells = async (chosen: Shell): Promise<Shell[]> => {
  const found: Shell[] = [];
  for (const shell of blockShells) {
    if (shell === chosen) continue;
    if (shell === Shell.Pwsh || shell === Shell.Powershell) {
      const file = profileFile(shell);
      if (file != null && (process.platform === "win32" || fs.existsSync(file))) found.push(shell);
    } else if (process.platform === "win32") {
      if (
        shell === Shell.Bash &&
        (await gitBashPath().then(
          () => true,
          () => false,
        ))
      )
        found.push(shell);
    } else {
      const file = profileFile(shell);
      if (file != null && fs.existsSync(file) && which.sync(shell, { nothrow: true }) != null) found.push(shell);
    }
  }
  return found;
};

// the folder holding the thint binary, when it runs as one (not through node)
const binaryFolder = (): string | undefined => {
  const name = path.basename(process.execPath);
  return name === "thint" || name === "terminalhinter" ? path.dirname(process.execPath) : undefined;
};

const shellPath = (folder: string, home: string) =>
  folder.startsWith(home + "/") || folder.startsWith(home + path.sep) ? "$HOME" + folder.slice(home.length) : folder;

export const startupBlock = (shell: Shell, folder = binaryFolder(), home = os.homedir()): string => {
  const lines = [beginMark];
  if (folder != null) {
    const dir = shellPath(folder, home);
    lines.push(
      shell === Shell.Fish
        ? `fish_add_path -g "${dir}"`
        : shell === Shell.Pwsh || shell === Shell.Powershell
        ? `$env:PATH = "${dir}" + [IO.Path]::PathSeparator + $env:PATH`
        : `export PATH="${dir}:$PATH"`,
    );
  }
  lines.push(getShellSourceCommand(shell).trim(), endMark);
  return lines.join("\n") + "\n";
};

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// the config without any terminalhinter block or loose startup line (also those of the old inshellisense install)
export const withoutStartupBlock = (text: string, shell: Shell): string => {
  let rest = text.replace(new RegExp(`^${escape(beginMark)}\\n[\\s\\S]*?^${escape(endMark)}\\n\\n?`, "gm"), "");
  rest = rest.replace(new RegExp(`^.*(?:inshellisense|terminalhinter)/init/${shell}.*\\n?`, "gm"), "");
  return rest.replace(/^\n+/, "");
};

// removes an earlier block and loose startup lines, then puts the block first
export const withStartupBlock = (text: string, block: string, shell: Shell): string => {
  const rest = withoutStartupBlock(text, shell);
  return block + (rest.length > 0 ? "\n" + rest : "");
};

// takes the startup lines out of the shell config; returns the file when something was removed
// A PowerShell profile on Windows usually has CRLF line ends and may start with a byte order mark, which Windows
// PowerShell needs to read anything but ASCII: both are taken off for the edit and put back after it.
const readConfig = (file: string) => {
  const raw = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const bom = raw.startsWith("\uFEFF");
  const crlf = raw.includes("\r\n");
  const text = (bom ? raw.slice(1) : raw).replace(/\r\n/g, "\n");
  return { raw, text, save: (next: string) => fs.writeFileSync(file, (bom ? "\uFEFF" : "") + (crlf ? next.replace(/\n/g, "\r\n") : next)) };
};

export const removeStartupBlock = (shell: Shell, file = profileFile(shell)): string | undefined => {
  if (file == null || !fs.existsSync(file)) return;
  const { text, save } = readConfig(file);
  const after = withoutStartupBlock(text, shell);
  if (after === text) return;
  save(after);
  return file;
};

export const installStartupBlock = (shell: Shell, file = profileFile(shell)): { file: string; backup?: string } => {
  if (file == null) throw new Error(`terminalhinter cannot edit the config of ${shell} for you`);
  const { raw, text, save } = readConfig(file);
  let backup: string | undefined;
  if (raw.length > 0) {
    backup = file + ".before-terminalhinter";
    if (!fs.existsSync(backup)) fs.writeFileSync(backup, raw);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  save(withStartupBlock(text, startupBlock(shell), shell));
  return { file, backup };
};
