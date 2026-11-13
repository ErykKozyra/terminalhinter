// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// The environment of the shell in the terminal, as it reports it at each prompt. terminalhinter starts at the top of
// the shell's startup file, so its own process.env misses whatever the rest of that file sets (PATH entries, cloud
// logins, KUBECONFIG, AWS_PROFILE) and anything exported later by hand. The commands behind the lists (kubectl get
// pods, aws s3 ls, git) run with this one, so they see what a command typed at the prompt would.

let reported: NodeJS.ProcessEnv | undefined;

// separates the variables in the report: a NUL cannot travel in bash, this byte practically never appears in a value
export const shellEnvSeparator = "\x1e";

export const parseShellEnv = (payload: string): NodeJS.ProcessEnv | undefined => {
  const env: NodeJS.ProcessEnv = {};
  for (const entry of payload.split(shellEnvSeparator)) {
    const at = entry.indexOf("=");
    if (at <= 0) continue;
    env[entry.slice(0, at)] = entry.slice(at + 1);
  }
  // a report without PATH is broken or cut short: keep the environment as it was rather than lose the programs
  return env.PATH != null || env.Path != null ? env : undefined;
};

export const setShellEnv = (env: NodeJS.ProcessEnv | undefined) => {
  if (env != null) reported = env;
};

// what a command run for the list gets: the shell's environment once it reported one, terminalhinter's own before that
export const commandEnv = (): NodeJS.ProcessEnv => reported ?? process.env;

export const resetShellEnv = () => {
  reported = undefined;
};
