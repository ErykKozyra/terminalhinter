// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// The tasks a project defines, with their descriptions: Makefile targets (the `## text` after a target is its
// description, `##@ Name` starts a section), just recipes, Taskfile tasks, docker compose services and mise tasks.

import path from "node:path";
import toml from "toml";
import YAML from "yaml";

import { findUp, memo, readText, run } from "./util.js";

type Task = Fig.Suggestion & { risk?: string };

const riskTag = /^\s*\[(prod|production|danger|caution)\]\s*/i;

const withTag = (name: string, text: string | undefined, kind: string): Task => {
  const tag = text?.match(riskTag)?.[1];
  const description = (text ?? "").replace(riskTag, "").trim();
  return { name, description: description || kind, priority: 80, risk: tag ? `marked [${tag.toLowerCase()}] in the project` : undefined };
};

export const makeTargets = (dir: string): Task[] => {
  const file = ["GNUmakefile", "makefile", "Makefile"].map((n) => path.join(dir, n)).find((f) => readText(f) !== "");
  if (file == null) return [];
  const targets = new Map<string, Task>();
  let section = "";
  for (const line of readText(file).split("\n")) {
    const heading = line.match(/^##@\s*(.+)$/);
    if (heading) {
      section = heading[1].trim();
      continue;
    }
    const target = line.match(/^([A-Za-z0-9][\w./-]*(?:\s+[A-Za-z0-9][\w./-]*)*)\s*:(?![=:])([^#]*?)(?:##\s*(.*))?$/);
    if (!target) continue;
    for (const name of target[1].split(/\s+/)) {
      if (name.startsWith(".") || name.includes("%") || targets.has(name)) continue;
      const task = withTag(name, target[3], "make target");
      if (section && task.description) task.description = `${section} · ${task.description}`;
      targets.set(name, task);
    }
  }
  return [...targets.values()];
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
      const lines = readText(file).split("\n");
      const out: Task[] = [];
      lines.forEach((line, i) => {
        const m = line.match(/^@?([A-Za-z][\w-]*)(?:\s+[^:=]*)?:(?!=)/);
        if (!m || m[1].startsWith("_") || /^(set|alias|export|import|mod)$/.test(m[1])) return;
        const doc = lines[i - 1]?.match(/^#\s?(.*)$/)?.[1];
        out.push(withTag(m[1], doc, "just recipe"));
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
        const doc = YAML.parse(readText(file)) as { tasks?: Record<string, { desc?: string; internal?: boolean } | string[]> };
        return Object.entries(doc?.tasks ?? {})
          .filter(([, t]) => !(t as { internal?: boolean })?.internal)
          .map(([name, t]) => withTag(name, (t as { desc?: string })?.desc, "task"));
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
    const doc = YAML.parse(readText(file)) as { services?: Record<string, { image?: string; build?: unknown; container_name?: string }> };
    return Object.entries(doc?.services ?? {}).map(([name, s]) => ({
      name,
      description: `service · ${s?.image ?? (s?.build != null ? "built here" : "")}`.replace(/ · $/, ""),
      priority: 80,
      risk: /prod/i.test(name) ? "looks like production" : undefined,
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
      const file = findUp(dir, ["mise.toml", ".mise.toml"]);
      if (file == null) return [];
      try {
        const doc = toml.parse(readText(file)) as { tasks?: Record<string, { description?: string; hide?: boolean } | string> };
        return Object.entries(doc.tasks ?? {})
          .filter(([, t]) => typeof t === "string" || !t.hide)
          .map(([name, t]) => withTag(name, typeof t === "string" ? t : t.description, "mise task"));
      } catch {
        return [];
      }
    }
  });

const dirOf = (context: Fig.GeneratorContext) => context.currentWorkingDirectory;

export const makeGenerator: Fig.Generator = { custom: async (_t, _e, c) => makeTargets(dirOf(c)) };
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
