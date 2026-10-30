// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// `thint doctor`: checks what usually goes wrong and says how to fix each problem.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import chalk from "chalk";
import toml from "toml";
import _Ajv from "ajv";

import { configPaths, configSchema } from "../utils/config.js";
import { initResourcesPath } from "../utils/constants.js";
import { getShellConfigName, getShellSourceCommand, Shell } from "../utils/shell.js";
import { beginMark, blockShells, profileFile } from "../utils/startupBlock.js";
import { loadCustomSpecs } from "../runtime/customSpecs.js";
import { getVersion } from "../utils/version.js";

const Ajv = _Ajv as unknown as typeof _Ajv.default;

export type Check = { status: "ok" | "warn" | "fail"; text: string; hint?: string };

const tildify = (file: string) => (file.startsWith(os.homedir() + path.sep) ? "~" + file.slice(os.homedir().length) : file);

const onPath = (name: string): string | undefined => {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      /* not here */
    }
  }
};

// How many lines run before the startup lines; those load twice (once outside terminalhinter, once inside).
export const linesBeforeStartup = (profile: string, shell: Shell): number | undefined => {
  const lines = profile.split("\n");
  const sourceCommand = getShellSourceCommand(shell).trim();
  const at = lines.findIndex((l) => l.trim() === beginMark || (sourceCommand !== "" && l.includes(sourceCommand)) || /terminalhinter\/init\//.test(l));
  if (at === -1) return undefined;
  return lines.slice(0, at).filter((l) => l.trim() !== "" && !l.trim().startsWith("#")).length;
};

export const shellChecks = (shell: Shell, file: string | undefined, loginShell: boolean): Check[] => {
  if (file == null) return [];
  if (!fs.existsSync(file)) {
    return loginShell ? [{ status: "fail", text: `${tildify(file)} does not exist, so ${shell} never starts terminalhinter`, hint: "thint init" }] : [];
  }
  const profile = fs.readFileSync(file, "utf8");
  const checks: Check[] = [];
  if (/inshellisense\/init\//.test(profile)) {
    checks.push({ status: "warn", text: `${tildify(file)} still has a line of the old inshellisense install`, hint: "thint init (replaces it)" });
  }
  const before = linesBeforeStartup(profile, shell);
  if (before == null) {
    if (loginShell) checks.push({ status: "fail", text: `${tildify(file)} has no terminalhinter startup lines`, hint: "thint init" });
    return checks;
  }
  if (before > 0) {
    checks.push({
      status: "warn",
      text: `${before} line${before === 1 ? "" : "s"} of ${tildify(file)} run before terminalhinter, so they load twice and new tabs open slower`,
      hint: "thint init (moves the startup lines to the top)",
    });
  } else {
    checks.push({ status: "ok", text: `${shell}: startup lines are at the top of ${tildify(file)}` });
  }
  const configName = getShellConfigName(shell);
  if (configName != null && !fs.existsSync(path.join(initResourcesPath, shell, configName))) {
    checks.push({ status: "fail", text: `the ${shell} startup file is missing`, hint: "thint reinit" });
  }
  return checks;
};

export const configChecks = (files = configPaths): Check[] => {
  const checks: Check[] = [];
  const ajv = new Ajv();
  for (const file of files.filter((p) => fs.existsSync(p))) {
    try {
      const parsed = toml.parse(fs.readFileSync(file, "utf8"));
      if (ajv.validate(configSchema, parsed)) checks.push({ status: "ok", text: `settings in ${tildify(file)} are valid` });
      else checks.push({ status: "fail", text: `${tildify(file)}: ${ajv.errorsText()}`, hint: "thint config list, then thint config set <key> <value>" });
    } catch (e) {
      const err = e as { line?: number; message: string };
      checks.push({
        status: "fail",
        text: `${tildify(file)} is not valid TOML (line ${err.line}: ${err.message})`,
        hint: "top-level keys go before any [section]",
      });
    }
  }
  return checks;
};

const legacyChecks = (): Check[] => {
  const home = os.homedir();
  const leftovers = [path.join(home, ".inshellisenserc"), path.join(home, ".local", "share", "inshellisense"), path.join(home, ".local", "bin", "is")].filter(
    (p) => fs.existsSync(p),
  );
  if (leftovers.length === 0) return [];
  return [
    {
      status: "warn",
      text: `leftovers of the old inshellisense install: ${leftovers.map(tildify).join(", ")}`,
      hint: `rm -rf ${leftovers.map(tildify).join(" ")}`,
    },
  ];
};

export const collectChecks = (): Check[] => {
  const checks: Check[] = [];
  const found = onPath("thint");
  checks.push(
    found
      ? { status: "ok", text: `thint ${getVersion()} at ${tildify(found)}` }
      : { status: "warn", text: "thint is not on your PATH", hint: 'export PATH="$HOME/.local/bin:$PATH" (thint init adds it)' },
  );
  checks.push(
    process.env.ISTERM === "1"
      ? { status: "ok", text: "this shell runs inside terminalhinter" }
      : { status: "warn", text: "this shell does not run inside terminalhinter", hint: "open a new terminal tab; if it stays like this, run thint init" },
  );
  const login = path.basename(process.env.SHELL ?? "");
  for (const shell of blockShells) checks.push(...shellChecks(shell, profileFile(shell), shell === login));
  checks.push(...configChecks());
  for (const e of loadCustomSpecs().errors) checks.push({ status: "warn", text: `${tildify(e.file)} is skipped: ${e.message}`, hint: "thint specs check" });
  checks.push(...legacyChecks());
  return checks;
};

export const render = async () => {
  const checks = collectChecks();
  for (const check of checks) {
    const mark = check.status === "ok" ? chalk.green("✓") : check.status === "warn" ? chalk.yellow("!") : chalk.red("✗");
    process.stdout.write(`${mark} ${check.text}\n`);
    if (check.hint) process.stdout.write(`  ${chalk.dim("fix:")} ${chalk.cyan(check.hint)}\n`);
  }
  process.exit(checks.filter((c) => c.status === "fail").length);
};
