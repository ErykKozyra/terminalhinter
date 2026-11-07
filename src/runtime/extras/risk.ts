// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// Marks what can hurt: options and subcommands that delete or rewrite things, and values that look like production
// (a name with "prod" in it or written in capitals, like an ssh host PROD). The list shows them with a red mark and
// says why in its footer; nothing is ever blocked.

type Rule = { command: string; path?: string[]; name: string | RegExp; reason: string };

const rules: Rule[] = [
  { command: "git", path: ["push"], name: /^(--force|-f)$/, reason: "overwrites the remote branch, other people's commits can be lost" },
  { command: "git", path: ["push"], name: "--force-with-lease", reason: "overwrites the remote branch if nobody pushed in the meantime" },
  { command: "git", path: ["push"], name: /^(--delete|-d)$/, reason: "deletes the branch on the remote" },
  { command: "git", path: ["push"], name: "--mirror", reason: "makes the remote match your repository, deleting what you do not have" },
  { command: "git", path: ["reset"], name: "--hard", reason: "throws away uncommitted changes" },
  { command: "git", path: ["clean"], name: /^-[a-z]*f/, reason: "deletes untracked files for good" },
  { command: "git", path: ["checkout"], name: /^(--force|-f)$/, reason: "throws away local changes" },
  { command: "git", path: ["branch"], name: "-D", reason: "deletes the branch even if it is not merged" },
  { command: "git", path: ["stash"], name: "clear", reason: "deletes every stash" },
  { command: "git", path: ["stash"], name: "drop", reason: "deletes the stash" },
  { command: "rm", name: /^-[a-zA-Z]*[rR]/, reason: "deletes folders and everything in them" },
  { command: "rm", name: /^-[a-zA-Z]*f/, reason: "deletes without asking" },
  { command: "docker", path: ["system"], name: "prune", reason: "deletes stopped containers, unused networks and images" },
  { command: "docker", path: ["volume"], name: "prune", reason: "deletes volumes that no container uses, with their data" },
  { command: "docker", path: ["system", "prune"], name: /^(-a|--all)$/, reason: "also deletes every image not used by a container" },
  { command: "docker", path: ["compose", "down"], name: /^(-v|--volumes)$/, reason: "also deletes the volumes and their data" },
  { command: "kubectl", name: "delete", reason: "deletes resources from the cluster" },
  { command: "terraform", name: "destroy", reason: "destroys the infrastructure" },
  { command: "terraform", path: ["apply"], name: "-auto-approve", reason: "applies without showing the plan first" },
  { command: "npm", path: ["unpublish"], name: /^(--force|-f)$/, reason: "removes a published version for everyone" },
  { command: "npm", name: "unpublish", reason: "removes a published version for everyone" },
  { command: "chmod", name: /^-[a-zA-Z]*R/, reason: "changes permissions of everything inside" },
  { command: "chown", name: /^-[a-zA-Z]*R/, reason: "changes the owner of everything inside" },
  { command: "dd", name: /^of=/, reason: "writes straight to the target, a wrong disk loses its data" },
  { command: "mkfs", name: /.*/, reason: "formats the device" },
  { command: "kill", name: "-9", reason: "stops the process without letting it clean up" },
];

const productionLike = /(^|[^a-z])(prod|production)([^a-z]|$)/i;

// for an option or subcommand offered after `words` (the command and the subcommands before it)
export const riskOfEntry = (words: string[], name: string): string | undefined => {
  const [command, ...rest] = words;
  for (const rule of rules) {
    if (rule.command !== command) continue;
    const path = rule.path ?? [];
    if (path.length > rest.length || path.some((p, i) => p !== rest[i])) continue;
    if (typeof rule.name === "string" ? rule.name === name : rule.name.test(name)) return rule.reason;
  }
  return undefined;
};

// for a value: a branch, an ssh host, a script, a kube context, a docker context
export const riskOfValue = (name: string): string | undefined => {
  if (productionLike.test(name)) return "looks like production";
  // all capitals and at least three letters, the way people name the server they must be careful with: PROD, LIVE-DB
  if (/^[A-Z][A-Z0-9_-]{2,}$/.test(name) && /[A-Z]{3}/.test(name)) return "written in capitals, often a production name";
  return undefined;
};

// for a whole typed line, shown when you ask what a command does
export const riskOfLine = (tokens: string[]): string[] => {
  const notes: string[] = [];
  const [command] = tokens;
  if (command === "rm" && tokens.some((t) => /^-[a-zA-Z]*[rR]/.test(t)) && tokens.some((t) => /^(\/|~\/?|\*|\.\/?\*?|\.\.)$/.test(t)))
    notes.push("deletes a whole tree: check the path twice");
  if (
    command === "git" &&
    tokens[1] === "push" &&
    tokens.some((t) => /^(--force|-f)$/.test(t)) &&
    tokens.some((t) => /^(main|master|production|prod)$/.test(t))
  )
    notes.push("force push to a main branch");
  if (command === "kubectl" && tokens.some((t, i) => (tokens[i - 1] === "--context" || t.startsWith("--context=")) && productionLike.test(t)))
    notes.push("kubectl against a production context");
  return notes;
};
