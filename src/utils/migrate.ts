// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// Moving over from Kiro CLI, Amazon Q or Fig: their startup lines are taken out of your shell files (with a backup),
// so they stop drawing their own popup or slowing the shell down next to terminalhinter.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const products = "Kiro CLI|Kiro|Amazon Q|Q|CodeWhisperer|Fig";

// a comment like "# Kiro CLI pre block. Keep at the top of this file." and the line after it that loads their script
const blockComment = new RegExp(`^\\s*#\\s*(${products})\\s+(pre|post)\\s+block\\b.*$`, "i");
const theirScript =
  /(kiro-cli|amazon-q|codewhisperer|\/\.fig\/|\.fig\/shell|fig\/shell)[^\n]*(zshrc|bashrc|bash_profile|zprofile|profile|config\.fish|\.zsh|\.bash|\.fish)/i;
const theirInit = /^\s*(eval\s+"\$\((kiro-cli|q|fig|cw)\s+init\b[^)]*\)"|(kiro-cli|q|fig)\s+init\s+\S+\s+(pre|post)\s*\|\s*source)/;

export type Change = { file: string; removed: string[]; backup?: string };

export const shellFiles = (home = os.homedir()): string[] => {
  const zdot = process.env.ZDOTDIR ?? home;
  return [
    path.join(zdot, ".zshrc"),
    path.join(zdot, ".zprofile"),
    path.join(zdot, ".zshenv"),
    path.join(zdot, ".zlogin"),
    path.join(home, ".bashrc"),
    path.join(home, ".bash_profile"),
    path.join(home, ".profile"),
    path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"), "fish", "config.fish"),
  ];
};

// the text without their lines, and the lines that were taken out
export const withoutTheirLines = (text: string): { text: string; removed: string[] } => {
  const lines = text.split("\n");
  const kept: string[] = [];
  const removed: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (blockComment.test(line)) {
      removed.push(line);
      // the line that loads their script right below the comment goes too
      if (i + 1 < lines.length && (theirScript.test(lines[i + 1]) || theirInit.test(lines[i + 1]))) removed.push(lines[++i]);
      continue;
    }
    if (theirScript.test(line) && /\b(source|\.|builtin source|eval)\b/.test(line)) {
      removed.push(line);
      continue;
    }
    if (theirInit.test(line)) {
      removed.push(line);
      continue;
    }
    kept.push(line);
  }
  // no run of empty lines where a block was
  return { text: kept.join("\n").replace(/\n{3,}/g, "\n\n"), removed };
};

export const planMigration = (files = shellFiles()): Change[] =>
  files.flatMap((file) => {
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      return [];
    }
    const { removed } = withoutTheirLines(text);
    return removed.length > 0 ? [{ file, removed }] : [];
  });

export const applyMigration = (changes: Change[]): Change[] =>
  changes.map((change) => {
    const text = fs.readFileSync(change.file, "utf8");
    // one copy per run, so a second migration never points to the copy of the first
    let backup = `${change.file}.before-thint-migrate`;
    for (let n = 2; fs.existsSync(backup); n++) backup = `${change.file}.before-thint-migrate.${n}`;
    fs.writeFileSync(backup, text);
    fs.writeFileSync(change.file, withoutTheirLines(text).text);
    return { ...change, backup };
  });

// the apps themselves, so the summary can say how to remove them; terminalhinter never deletes them
export const installedApps = (home = os.homedir()): string[] =>
  [
    "/Applications/Kiro CLI.app",
    "/Applications/Amazon Q.app",
    "/Applications/Fig.app",
    "/Applications/CodeWhisperer.app",
    path.join(home, ".local", "bin", "kiro-cli"),
    path.join(home, ".local", "bin", "q"),
    path.join(home, ".fig"),
  ].filter((p) => fs.existsSync(p));

// Fig keeps the specs you wrote in ~/.fig/autocomplete/build; terminalhinter can load them as they are
export const figSpecFolders = (home = os.homedir()): string[] =>
  [path.join(home, ".fig", "autocomplete", "build")].filter((p) => fs.existsSync(path.join(p, "index.js")));
