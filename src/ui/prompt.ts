// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// A small arrow-key picker for the terminal, with an optional live preview under the list.

import readline from "node:readline";
import chalk from "chalk";

export type Choice<T> = { label: string; value: T; hint?: string };

export class PromptCancelled extends Error {
  constructor() {
    super("cancelled");
    this.name = "PromptCancelled";
  }
}

type SelectOptions<T> = {
  title: string;
  choices: Choice<T>[];
  initial?: number;
  preview?: (value: T) => Promise<string[]> | string[];
  input?: NodeJS.ReadStream;
  output?: NodeJS.WriteStream;
};

export const select = async <T>({ title, choices, initial = 0, preview, input = process.stdin, output = process.stdout }: SelectOptions<T>): Promise<T> => {
  let index = Math.min(Math.max(initial, 0), choices.length - 1);
  let drawnLines = 0;
  let drawing = Promise.resolve();

  const draw = (final = false) => {
    drawing = drawing.then(async () => {
      const lines: string[] = [];
      const choice = choices[index];
      if (final) {
        lines.push(`${chalk.green("✓")} ${chalk.bold(title)} ${chalk.cyan(choice.label)}`);
      } else {
        lines.push(`${chalk.cyan("?")} ${chalk.bold(title)} ${chalk.dim("(↑/↓, Enter)")}`);
        choices.forEach((c, i) => {
          const active = i === index;
          const label = active ? chalk.cyan.bold(`❯ ${c.label}`) : `  ${c.label}`;
          lines.push(c.hint ? `${label}  ${chalk.dim(c.hint)}` : label);
        });
        if (preview) {
          lines.push("");
          lines.push(...(await preview(choice.value)));
        }
      }
      let out = "";
      if (drawnLines > 0) out += `\x1b[${drawnLines}A\r`;
      out += "\x1b[J" + lines.join("\n") + "\n";
      output.write(out);
      drawnLines = lines.length;
    });
    return drawing;
  };

  readline.emitKeypressEvents(input);
  const wasRaw = input.isRaw;
  if (input.isTTY) input.setRawMode(true);
  input.resume();
  output.write("\x1b[?25l"); // hide the cursor while picking

  try {
    await draw();
    return await new Promise<T>((resolve, reject) => {
      const onKey = (_: string, key: readline.Key | undefined) => {
        if (key == null) return;
        if ((key.ctrl && key.name === "c") || key.name === "escape" || key.name === "q") {
          input.off("keypress", onKey);
          reject(new PromptCancelled());
          return;
        }
        if (key.name === "up" || key.name === "k") index = (index - 1 + choices.length) % choices.length;
        else if (key.name === "down" || key.name === "j" || key.name === "tab") index = (index + 1) % choices.length;
        else if (key.name === "return" || key.name === "enter") {
          input.off("keypress", onKey);
          void draw(true).then(() => resolve(choices[index].value));
          return;
        } else return;
        void draw();
      };
      input.on("keypress", onKey);
    });
  } finally {
    await drawing;
    output.write("\x1b[?25h");
    if (input.isTTY) input.setRawMode(wasRaw ?? false);
    input.pause();
  }
};
