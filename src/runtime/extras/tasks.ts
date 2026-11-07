// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// The tasks a project defines, with their descriptions: Makefile targets (the `## text` after a target is its
// description, `##@ Name` starts a section), just recipes, Taskfile tasks, docker compose services and mise tasks.

import path from "node:path";
import toml from "toml";
import YAML from "yaml";

import { findUp, memo, readText, run } from "./util.js";
import { riskOfValue } from "./risk.js";

type Task = Fig.Suggestion & { risk?: string; args?: Fig.Arg };

const riskTag = /^\s*\[(prod|production|danger|caution)\]\s*/i;

const withTag = (name: string, text: string | undefined, kind: string): Task => {
  const tag = text?.match(riskTag)?.[1];
  const description = (text ?? "").replace(riskTag, "").trim();
  return { name, description: description || kind, priority: 80, risk: tag ? `marked [${tag.toLowerCase()}] in the project` : undefined };
};

// `file` is the Makefile to read: -f/--file and -C/--directory on the line choose another one
export const makeTargets = (dir: string, file?: string): Task[] => {
  const path_ = file ?? ["GNUmakefile", "makefile", "Makefile"].map((n) => path.join(dir, n)).find((f) => readText(f) !== "");
  if (path_ == null) return [];
  const targets = new Map<string, Task>();
  let section = "";
  let inDefine = false;
  for (const raw of readText(path_).split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (/^\s*define\b/.test(line)) inDefine = true;
    if (inDefine) {
      if (/^\s*endef\b/.test(line)) inDefine = false;
      continue;
    }
    const heading = line.match(/^##@\s*(.+)$/);
    if (heading) {
      section = heading[1].trim();
      continue;
    }
    const target = line.match(/^([A-Za-z0-9][\w./-]*(?:\s+[A-Za-z0-9][\w./-]*)*)\s*::?(?!=)([^#]*?)(?:##\s*(.*))?$/);
    if (!target) continue;
    // `release: CFLAGS += -O2` sets a variable for the target, it is not the target's own line
    if (/^\s*[\w.-]+\s*[:+?!]?=/.test(target[2])) continue;
    for (const name of target[1].split(/\s+/)) {
      if (name.startsWith(".") || name.includes("%")) continue;
      const known = targets.get(name);
      if (known != null && (known.description || !target[3])) continue;
      const task = withTag(name, target[3], "");
      task.description = target[3] ? (section ? `${section} · ${task.description}` : task.description) : section || undefined;
      targets.set(name, task);
    }
  }
  return [...targets.values()];
};

const makefileFrom = (tokens: string[], cwd: string): { dir: string; file?: string } => {
  let dir = cwd;
  let file: string | undefined;
  tokens.forEach((t, i) => {
    const next = tokens[i + 1];
    if ((t === "-C" || t === "--directory") && next) dir = path.resolve(dir, next);
    else if (t.startsWith("--directory=")) dir = path.resolve(dir, t.slice(12));
    else if ((t === "-f" || t === "--file" || t === "--makefile") && next) file = next;
    else if (t.startsWith("--file=") || t.startsWith("--makefile=")) file = t.slice(t.indexOf("=") + 1);
  });
  return { dir, file: file ? path.resolve(dir, file) : undefined };
};

const justCache = memo<Task[]>(5000);
export const justRecipes = (dir: string): Promise<Task[]> =>
  justCache(dir, async () => {
    const json = await run("just", ["--dump", "--dump-format", "json"], dir, 1500);
    try {
      const recipes = JSON.parse(json).recipes as Record<string, { doc?: string | null; private?: boolean; parameters?: { name: string }[] }>;
      return Object.entries(recipes)
        .filter(([name, r]) => !r.private && !name.startsWith("_"))
        .map(([name, r]) => {
          const task = withTag(name, r.doc ?? undefined, "just recipe");
          const params = (r.parameters ?? []).map((p) => `<${p.name}>`).join(" ");
          return params ? { ...task, args: { name: params } } : task;
        });
    } catch {
      // no just installed: read the justfile, a `# comment` right above a recipe is its description
      const file = findUp(dir, ["justfile", "Justfile", ".justfile"]);
      if (file == null) return [];
      const lines = readText(file)
        .split("\n")
        .map((l) => l.replace(/\r$/, ""));
      const out: Task[] = [];
      lines.forEach((line, i) => {
        const m = line.match(/^@?([A-Za-z][\w-]*)((?:\s+[^:]*?)?)\s*:(?!=)/);
        if (!m || m[1].startsWith("_") || /^(set|alias|export|import|mod)$/.test(m[1])) return;
        // attributes above the recipe: [private], [group('x')], [doc("...")]; the comment sits above them
        let j = i - 1;
        let doc: string | undefined;
        let hidden = false;
        while (j >= 0 && /^\s*\[.*\]\s*$/.test(lines[j])) {
          if (/\bprivate\b/.test(lines[j])) hidden = true;
          doc ??= lines[j].match(/doc\(\s*["'](.*)["']\s*\)/)?.[1];
          j--;
        }
        if (hidden) return;
        doc ??= lines[j]?.match(/^#\s?(.*)$/)?.[1];
        const params = m[2].trim();
        const task = withTag(m[1], doc, "just recipe");
        out.push(params ? { ...task, args: { name: params } } : task);
      });
      return out;
    }
  });

const taskCache = memo<Task[]>(5000);
export const taskfileTasks = (dir: string): Promise<Task[]> =>
  taskCache(dir, async () => {
    const json = await run("task", ["--list-all", "--json"], dir, 1500);
    try {
      return (JSON.parse(json).tasks as { name: string; desc?: string; summary?: string }[]).map((t) => withTag(t.name, t.desc || t.summary, "task"));
    } catch {
      const file = findUp(dir, ["Taskfile.yml", "Taskfile.yaml", "taskfile.yml", "taskfile.yaml"]);
      if (file == null) return [];
      try {
        type Doc = {
          tasks?: Record<string, { desc?: string; summary?: string; internal?: boolean } | string[]>;
          includes?: Record<string, string | { taskfile?: string; internal?: boolean }>;
        };
        const read = (f: string, prefix: string, depth: number): Task[] => {
          const doc = YAML.parse(readText(f)) as Doc;
          const own = Object.entries(doc?.tasks ?? {})
            .filter(([, t]) => !(t as { internal?: boolean })?.internal)
            .map(([name, t]) => withTag(prefix + name, (t as { desc?: string })?.desc || (t as { summary?: string })?.summary?.split("\n")[0], "task"));
          if (depth > 2) return own;
          // included Taskfiles: their tasks are called namespace:task
          const included = Object.entries(doc?.includes ?? {}).flatMap(([ns, inc]) => {
            if (typeof inc === "object" && inc?.internal) return [];
            let target = path.resolve(path.dirname(f), typeof inc === "string" ? inc : inc?.taskfile ?? "");
            if (!/\.ya?ml$/.test(target)) target = ["Taskfile.yml", "Taskfile.yaml"].map((n) => path.join(target, n)).find((t) => readText(t) !== "") ?? target;
            try {
              return read(target, `${prefix}${ns}:`, depth + 1);
            } catch {
              return [];
            }
          });
          return [...own, ...included];
        };
        return read(file, "", 0);
      } catch {
        return [];
      }
    }
  });

const composeFiles = ["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"];
export const composeServices = (dir: string): Task[] => {
  const file = findUp(dir, composeFiles);
  if (file == null) return [];
  try {
    const doc = YAML.parse(readText(file), { merge: true }) as { services?: Record<string, { image?: string; build?: unknown; container_name?: string }> };
    return Object.entries(doc?.services ?? {}).map(([name, s]) => ({
      name,
      description: `service · ${s?.image ?? (s?.build != null ? "built here" : "")}`.replace(/ · $/, ""),
      priority: 80,
      risk: riskOfValue(name),
    }));
  } catch {
    return [];
  }
};

const miseCache = memo<Task[]>(5000);
export const miseTasks = (dir: string): Promise<Task[]> =>
  miseCache(dir, async () => {
    const json = await run("mise", ["tasks", "ls", "--json"], dir, 1500);
    try {
      return (JSON.parse(json) as { name: string; description?: string; hide?: boolean }[])
        .filter((t) => !t.hide)
        .map((t) => withTag(t.name, t.description, "mise task"));
    } catch {
      const root = findUp(dir, ["mise.toml", ".mise.toml"]);
      if (root == null) return [];
      const seen = new Map<string, Task>();
      for (const file of ["mise.toml", ".mise.toml", "mise.local.toml"].map((n) => path.join(path.dirname(root), n))) {
        try {
          const doc = toml.parse(readText(file) || "") as {
            tasks?: Record<string, { description?: string; hide?: boolean; run?: string | string[] } | string>;
          };
          for (const [name, t] of Object.entries(doc.tasks ?? {})) {
            if (seen.has(name) || (typeof t !== "string" && t.hide)) continue;
            const run = typeof t === "string" ? t : Array.isArray(t.run) ? t.run.join(" && ") : t.run;
            seen.set(name, withTag(name, typeof t !== "string" && t.description ? t.description : run ? `runs ${run}` : undefined, "mise task"));
          }
        } catch {
          /* a broken file is skipped */
        }
      }
      return [...seen.values()];
    }
  });

const dirOf = (context: Fig.GeneratorContext) => context.currentWorkingDirectory;

export const makeGenerator: Fig.Generator = {
  custom: async (tokens, _e, c) => {
    const { dir, file } = makefileFrom(tokens, dirOf(c));
    return makeTargets(dir, file);
  },
};

// deno.json(c) tasks, for `deno task `
export const denoTasks = (dir: string): Task[] => {
  const file = findUp(dir, ["deno.json", "deno.jsonc"]);
  if (file == null) return [];
  try {
    const text = readText(file).replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, str) => str ?? "");
    const tasks = (JSON.parse(text) as { tasks?: Record<string, string | { command?: string; description?: string }> }).tasks ?? {};
    return Object.entries(tasks).map(([name, t]) =>
      withTag(name, typeof t === "string" ? `runs ${t}` : t.description ?? (t.command ? `runs ${t.command}` : undefined), "deno task"),
    );
  } catch {
    return [];
  }
};
export const denoTaskGenerator: Fig.Generator = { custom: async (_t, _e, c) => denoTasks(dirOf(c)) };
export const justGenerator: Fig.Generator = { custom: async (_t, _e, c) => justRecipes(dirOf(c)) };
export const taskGenerator: Fig.Generator = { custom: async (_t, _e, c) => taskfileTasks(dirOf(c)) };
export const composeGenerator: Fig.Generator = { custom: async (_t, _e, c) => composeServices(dirOf(c)) };
export const miseGenerator: Fig.Generator = { custom: async (_t, _e, c) => miseTasks(dirOf(c)) };

export const composeSubcommands = [
  "up",
  "down",
  "logs",
  "restart",
  "exec",
  "run",
  "build",
  "stop",
  "start",
  "ps",
  "pull",
  "rm",
  "kill",
  "top",
  "attach",
  "watch",
];
