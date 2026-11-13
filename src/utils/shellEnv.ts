// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The environment of the shell in the terminal, as it reports it at the prompt. terminalhinter starts at the top of
// the shell's startup file, so its own process.env misses whatever the rest of that file sets (PATH entries, cloud
// logins, KUBECONFIG, AWS_PROFILE) and anything exported later by hand. The commands behind the lists (kubectl get
// pods, aws s3 ls, git) run with this one, so they see what a command typed at the prompt would.
//
// The shell writes its variables to a private file and only says "ENV" in the terminal: a report of several
// kilobytes inside the output got printed as text by GNU screen around thint.

let reported: NodeJS.ProcessEnv | undefined;

// separates the variables in the file: a NUL cannot be held by bash, this byte practically never appears in a value
export const shellEnvSeparator = "\x1e";

const posixPath = (value: string | undefined) => value != null && value.startsWith("/") && !value.includes(";");

export const parseShellEnv = (payload: string, platform: NodeJS.Platform = process.platform): NodeJS.ProcessEnv | undefined => {
  const env: NodeJS.ProcessEnv = {};
  for (const entry of payload.split(shellEnvSeparator)) {
    const at = entry.indexOf("=");
    if (at <= 0) continue;
    env[entry.slice(0, at)] = entry.slice(at + 1);
  }
  // a report without PATH is broken or cut short: keep the environment as it was rather than lose the programs
  if (env.PATH == null && env.Path == null) return undefined;
  if (platform === "win32") {
    // Git Bash and the other MSYS shells report PATH as /usr/bin:/c/..., which Windows programs cannot search: their
    // own PATH stays, the rest of the report is laid over terminalhinter's environment
    if (posixPath(env.PATH)) delete env.PATH;
    if (posixPath(env.Path)) delete env.Path;
    return { ...process.env, ...env };
  }
  return env;
};

export const setShellEnv = (env: NodeJS.ProcessEnv | undefined) => {
  if (env != null) reported = env;
};

// what a command run for the list gets: the shell's environment once it reported one, terminalhinter's own before that
export const commandEnv = (): NodeJS.ProcessEnv => reported ?? process.env;

export const resetShellEnv = () => {
  reported = undefined;
};

// The file the shell writes its variables to: in a folder only this user can open, removed when terminalhinter exits.
// Created empty with owner-only permissions, so the shell's `>|` keeps them when it writes.
export const createShellEnvFile = (): string | undefined => {
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thint-env-"));
    const file = path.join(dir, "env");
    fs.writeFileSync(file, "", { mode: 0o600 });
    process.once("exit", () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // the system cleans its temp folder anyway
      }
    });
    return file;
  } catch {
    return undefined;
  }
};

export const readShellEnvFile = (file: string | undefined) => {
  if (file == null) return;
  try {
    setShellEnv(parseShellEnv(fs.readFileSync(file, "utf8")));
  } catch {
    // a report that cannot be read leaves the last good one in place
  }
};
