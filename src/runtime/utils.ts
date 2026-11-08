// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import { spawn } from "node:child_process";
import fsAsync from "node:fs/promises";
import { homedir } from "node:os";

import { CommandToken } from "./parser.js";
import { getPathSeparator, gitBashPath, Shell } from "../utils/shell.js";
import log from "../utils/log.js";

export type ExecuteShellCommandTTYResult = {
  code: number | null;
};

const getExecutionShell = async (): Promise<undefined | string> => {
  if (process.platform !== "win32") return;
  try {
    return await gitBashPath();
  } catch (e) {
    log.debug({ msg: "failed to load posix shell for windows child_process.spawn, some generators might fail", error: e });
  }
};

const bashSpecialCharacters = /[&|<>\s]/g;
// escape whitespace & special characters in an argument when not quoted
const shouldEscapeArg = (arg: string) => {
  const hasSpecialCharacter = bashSpecialCharacters.test(arg);
  const isSingleCharacter = arg.length === 1;
  return hasSpecialCharacter && !isSingleCharacter && !isQuoted(arg, `"`);
};

/* based on libuv process.c used by nodejs, only quotes are escaped for shells. if using git bash need to escape whitespace & special characters in an argument */
const escapeArgs = (shell: string | undefined, args: string[]) => {
  // only escape args for git bash
  if (process.platform !== "win32" || shell == undefined) return args;
  return args.map((arg) => (shouldEscapeArg(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg));
};

type QuoteChar = `"` | `'` | "`";

const isQuoted = (value: string | undefined, quoteChar: QuoteChar): boolean => (value?.startsWith(quoteChar) && value?.endsWith(quoteChar)) ?? false;

const quoteString = (value: string, quoteChar: QuoteChar): string => {
  if (isQuoted(value, quoteChar)) return value;
  const escapedValue = value.replaceAll(`\\${quoteChar}`, quoteChar).replaceAll(quoteChar, `\\${quoteChar}`);
  return `${quoteChar}${escapedValue}${quoteChar}`;
};

const needsQuoted = (value: string, quoteChar: QuoteChar): boolean => isQuoted(value, quoteChar) || value.includes(" ");

const getShellQuoteChar = (shell: Shell): QuoteChar => {
  switch (shell) {
    case Shell.Zsh:
    case Shell.Bash:
    case Shell.Fish:
      return `"`;
    case Shell.Xonsh:
      return `'`;
    case Shell.Nushell:
      return "`";
    case Shell.Pwsh:
    case Shell.Powershell:
      return `'`;
    case Shell.Cmd:
      return `"`;
  }
};

export const getShellWhitespaceEscapeChar = (shell: Shell): string => {
  switch (shell) {
    case Shell.Zsh:
    case Shell.Bash:
    case Shell.Fish:
    case Shell.Xonsh:
    case Shell.Nushell:
      return "\\";
    case Shell.Pwsh:
    case Shell.Powershell:
      return "`";
    case Shell.Cmd:
      return "^";
  }
};

export const escapePath = (value: string | undefined, shell: Shell): string | undefined =>
  value != null && needsQuoted(value, getShellQuoteChar(shell)) ? quoteString(value, getShellQuoteChar(shell)) : value;

export const buildExecuteShellCommand =
  (timeout: number, signal?: AbortSignal): Fig.ExecuteCommandFunction =>
  async ({ command, env, args, cwd }: Fig.ExecuteCommandInput): Promise<Fig.ExecuteCommandOutput> => {
    signal?.throwIfAborted();
    const executionShell = await getExecutionShell();
    const escapedArgs = escapeArgs(executionShell, args);
    // detached = a session of its own, without the terminal: an interactive shell started here (`zsh -i -c alias` for
    // the alias list) would otherwise take over the terminal, and terminalhinter, no longer in front, got stopped
    // ("suspended (tty output)") so the tab was left with a plain shell
    const detached = process.platform !== "win32";
    const child = spawn(command, escapedArgs, { cwd, env: { ...process.env, ...env, ISTERM: "1" }, shell: executionShell, signal, detached });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => (stdout += data));
    child.stderr.on("data", (data) => (stderr += data));
    child.on("error", (err) => {
      log.debug({ msg: "shell command failed", command, args, e: err.message });
    });
    return new Promise((resolve) => {
      let settled = false;
      // `sleep 30; echo x` or `kubectl get pods | awk ...` run under a shell: killing only that shell left the
      // programs it started holding the output open, so the command never ended and the list stopped updating for the
      // whole session. The whole group goes, and the answer comes back at the time limit whatever is still running.
      const stop = () => {
        try {
          if (detached && child.pid != null) process.kill(-child.pid, "SIGKILL");
          else child.kill("SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
        child.stdout.destroy();
        child.stderr.destroy();
      };
      const finish = (status: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimeout);
        signal?.removeEventListener("abort", onAbort);
        resolve({ status, stderr, stdout });
      };
      const onAbort = () => {
        stop();
        finish(0);
      };
      const killTimeout = setTimeout(() => {
        log.debug({ msg: "shell command timed out", command, args, timeout });
        stop();
        finish(0);
      }, timeout);
      signal?.addEventListener("abort", onAbort, { once: true });
      child.on("close", (code) => finish(code ?? 0));
    });
  };

const isHomedir = (path: string) => path.startsWith("~");

export const resolveCwd = async (
  cmdToken: CommandToken | undefined,
  cwd: string,
  shell: Shell,
  signal?: AbortSignal,
): Promise<{ cwd: string; pathy: boolean; complete: boolean }> => {
  if (cmdToken == null || cmdToken.complete) return { cwd, pathy: false, complete: false };
  // the parser already removed the quotes and backslash escapes, so the token is the real file name
  const { token: pathToken } = cmdToken;
  const sep = getPathSeparator(shell);
  // Windows takes both separators, whatever the shell: `ls src/` in cmd is as much a path as `ls src\`
  const seps = process.platform === "win32" ? [...new Set([sep, "\\", "/"])] : [sep];
  const endsWithSep = seps.some((s) => pathToken.endsWith(s));
  if (pathToken === "~") return { cwd: homedir(), pathy: true, complete: false };
  if (seps.some((s) => pathToken === `~${s}`)) return { cwd: homedir(), pathy: true, complete: true };
  if (!seps.some((s) => pathToken.includes(s))) return { cwd, pathy: false, complete: false };
  const tokenComplete = endsWithSep;
  const trimmedToken = endsWithSep ? pathToken : path.dirname(pathToken);
  const token = trimmedToken;
  const resolvedCwd = path.isAbsolute(token) ? token : isHomedir(token) ? token.replace("~", homedir()) : path.join(cwd, token);
  try {
    signal?.throwIfAborted();
    await fsAsync.access(resolvedCwd, fsAsync.constants.R_OK);
    return { cwd: resolvedCwd, pathy: true, complete: tokenComplete };
  } catch {
    // fallback to the parent folder if possible
    const baselessCwd = resolvedCwd.substring(0, resolvedCwd.length - path.basename(resolvedCwd).length);
    try {
      signal?.throwIfAborted();
      await fsAsync.access(baselessCwd, fsAsync.constants.R_OK);
      return { cwd: baselessCwd, pathy: true, complete: tokenComplete };
    } catch {
      /*empty*/
    }
    return { cwd, pathy: false, complete: false };
  }
};
