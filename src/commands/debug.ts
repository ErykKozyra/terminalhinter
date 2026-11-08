// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import chalk from "chalk";
import { Command } from "commander";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The keys thint reacts to. What a terminal sends for them differs between apps and settings, so a recording from
// each app tells whether thint understands it there.
const keysToPress = [
  "Tab",
  "Shift+Tab",
  "Enter",
  "Esc",
  "Backspace",
  "Ctrl+Backspace",
  "Up",
  "Down",
  "Left",
  "Right",
  "Shift+Up",
  "Shift+Down",
  "Home",
  "End",
  "Ctrl+Space",
  "Ctrl+G",
  "Ctrl+U",
  "Ctrl+W",
  "Alt+Left (Option+Left on a Mac)",
  "Alt+Right (Option+Right on a Mac)",
  "Alt+Backspace (Option+Backspace on a Mac)",
  "Alt+B (Option+B on a Mac)",
  "ą (or any letter with an accent)",
  "an emoji (Ctrl+Cmd+Space on a Mac, Win+. on Windows)",
  "Paste: copy two lines of text and paste them",
];

const hex = (data: Buffer) => [...data].map((b) => b.toString(16).padStart(2, "0")).join(" ");
const visible = (data: Buffer) =>
  [...data.toString("utf8")]
    .map((c) => (c === "\x1b" ? "ESC" : c.charCodeAt(0) < 32 || c === "\x7f" ? `^${String.fromCharCode((c.charCodeAt(0) + 64) % 128)}` : c))
    .join("");

const keys = new Command("keys")
  .description("record what this terminal sends for the keys thint uses, to check it understands them")
  .option("-o, --out <file>", "where to save the recording")
  .action(async (options: { out?: string }) => {
    if (!process.stdin.isTTY) {
      process.stderr.write("run this in a terminal window\n");
      process.exitCode = 1;
      return;
    }
    const terminal = process.env.TERM_PROGRAM ?? process.env.TERMINAL_EMULATOR ?? (process.env.WT_SESSION ? "Windows Terminal" : process.env.TERM ?? "unknown");
    const out = options.out ?? path.join(os.homedir(), `thint-keys-${terminal.replace(/[^\w.-]+/g, "_")}.json`);
    const recorded: { key: string; bytes: string; text: string }[] = [];
    process.stdout.write(
      `Press each key when it is asked for. Space skips a key, Ctrl+C stops.\nTerminal: ${terminal}${process.env.TMUX ? " inside tmux" : ""}\n\n`,
    );
    process.stdin.setRawMode(true);
    // bracketed paste on, so a paste shows up the way the shell sees it
    process.stdout.write("\x1b[?2004h");
    process.stdin.resume();
    let stopped = false;
    for (const key of keysToPress) {
      process.stdout.write(`  ${chalk.bold(key)}: `);
      const data = await new Promise<Buffer>((resolve) => {
        let chunks: Buffer[] = [];
        let timer: NodeJS.Timeout | undefined;
        const onData = (chunk: Buffer) => {
          chunks.push(chunk);
          // a key can arrive in pieces; wait a moment for the rest
          clearTimeout(timer);
          timer = setTimeout(() => {
            process.stdin.off("data", onData);
            resolve(Buffer.concat(chunks));
            chunks = [];
          }, 120);
        };
        process.stdin.on("data", onData);
      });
      if (data.length === 1 && data[0] === 3) {
        stopped = true;
        process.stdout.write("stopped\n");
        break;
      }
      if (data.length === 1 && data[0] === 0x20) {
        process.stdout.write(chalk.dim("skipped\r\n"));
        continue;
      }
      recorded.push({ key, bytes: hex(data), text: visible(data) });
      process.stdout.write(`${chalk.dim(visible(data))}\r\n`);
    }
    process.stdout.write("\x1b[?2004l");
    process.stdin.setRawMode(false);
    process.stdin.pause();
    const report = {
      terminal,
      termProgramVersion: process.env.TERM_PROGRAM_VERSION,
      term: process.env.TERM,
      tmux: process.env.TMUX != null,
      platform: process.platform,
      recordedAt: new Date().toISOString(),
      complete: !stopped,
      keys: recorded,
    };
    fs.writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
    process.stdout.write(`\n${chalk.green("✓")} saved ${out}\n`);
  });

const cmd = new Command("debug").description("tools for checking thint in your terminal").addCommand(keys);

export default cmd;
