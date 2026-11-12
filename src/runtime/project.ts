// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// Project awareness: knows the packages of a pnpm / npm / yarn workspace, the tasks of a Turborepo, and adds the age
// and subject of the last commit to git branch suggestions. Works by patching the upstream command specs after they
// load, so the rest of the runtime does not change.

import fs from "node:fs";
import fsAsync from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";

import { Suggestion } from "./model.js";
import { SuggestionIcons } from "./suggestion.js";
import log from "../utils/log.js";
import { augmentGit } from "./extras/git.js";
import { pidGenerator, portGenerator } from "./extras/processes.js";
import {
  composeFallback,
  composeGenerator,
  composeSubcommands,
  denoTaskGenerator,
  justGenerator,
  makeGenerator,
  miseGenerator,
  taskGenerator,
} from "./extras/tasks.js";
import { versionGenerator } from "./extras/versions.js";
import { executeGenerator } from "./generator.js";

const findUp = (start: string, names: string[]): string | undefined => {
  let dir = path.resolve(start);
  for (;;) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
};

const readJson = async (file: string): Promise<Record<string, unknown> | undefined> => {
  try {
    // turbo.json allows comments; strip line and block comments that are not inside strings
    const text = (await fsAsync.readFile(file, "utf8")).replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, str) => str ?? "");
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return;
  }
};

// pnpm-workspace.yaml is read line by line: only the `packages:` list matters here
const pnpmWorkspaceGlobs = async (file: string): Promise<string[]> => {
  const text = await fsAsync.readFile(file, "utf8").catch(() => "");
  const globs: string[] = [];
  let inPackages = false;
  for (const line of text.split("\n")) {
    if (/^packages\s*:/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages && /^\S/.test(line)) break;
    const item = line.match(/^\s*-\s*['"]?([^'"#]+?)['"]?\s*(?:#.*)?$/);
    if (inPackages && item) globs.push(item[1].trim());
  }
  return globs;
};

const expandGlob = async (root: string, glob: string): Promise<string[]> => {
  if (glob.startsWith("!")) return [];
  const parts = glob.replace(/\/+$/, "").split("/");
  const walk = async (dir: string, index: number): Promise<string[]> => {
    if (index === parts.length) return [dir];
    const part = parts.at(index) ?? "";
    if (part === "**") {
      const here = await walk(dir, index + 1);
      if (index > 4) return here;
      const children = await fsAsync.readdir(dir, { withFileTypes: true }).catch(() => []);
      const deeper = await Promise.all(
        children.filter((c) => c.isDirectory() && c.name !== "node_modules" && !c.name.startsWith(".")).map((c) => walk(path.join(dir, c.name), index)),
      );
      return here.concat(deeper.flat());
    }
    if (part.includes("*")) {
      const pattern = new RegExp("^" + part.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
      const children = await fsAsync.readdir(dir, { withFileTypes: true }).catch(() => []);
      const matched = await Promise.all(
        children.filter((c) => c.isDirectory() && c.name !== "node_modules" && pattern.test(c.name)).map((c) => walk(path.join(dir, c.name), index + 1)),
      );
      return matched.flat();
    }
    return walk(path.join(dir, part), index + 1);
  };
  return walk(root, 0);
};

export type WorkspacePackage = { name: string; dir: string };

export const workspacePackages = async (cwd: string): Promise<WorkspacePackage[]> => {
  const marker = findUp(cwd, ["pnpm-workspace.yaml"]) ?? findUp(cwd, ["package.json"]);
  if (marker == null) return [];
  let root = path.dirname(marker);
  let globs: string[] = [];
  if (marker.endsWith("pnpm-workspace.yaml")) {
    globs = await pnpmWorkspaceGlobs(marker);
  } else {
    // the nearest package.json may be a workspace member: climb to the one that declares workspaces
    let pkgFile: string | undefined = marker;
    while (pkgFile != null) {
      const pkg = await readJson(pkgFile);
      const workspaces = pkg?.workspaces;
      const list = Array.isArray(workspaces) ? workspaces : (workspaces as { packages?: unknown } | undefined)?.packages;
      if (Array.isArray(list)) {
        globs = list.filter((g): g is string => typeof g === "string");
        root = path.dirname(pkgFile);
        break;
      }
      const parent = path.dirname(path.dirname(pkgFile));
      pkgFile = parent === path.dirname(pkgFile) ? undefined : findUp(parent, ["package.json"]);
    }
  }
  const dirs = (await Promise.all(globs.map((g) => expandGlob(root, g)))).flat();
  const packages = await Promise.all(
    [...new Set(dirs)].map(async (dir) => {
      const pkg = await readJson(path.join(dir, "package.json"));
      return typeof pkg?.name === "string" ? { name: pkg.name, dir } : undefined;
    }),
  );
  return packages.filter((p): p is WorkspacePackage => p != null).sort((a, b) => a.name.localeCompare(b.name));
};

export const turboTasks = async (cwd: string): Promise<Fig.Suggestion[]> => {
  const file = findUp(cwd, ["turbo.json", "turbo.jsonc"]);
  if (file == null) return [];
  const config = await readJson(file);
  // turbo 2 calls them `tasks`, turbo 1 `pipeline`
  const tasks = (config?.tasks ?? config?.pipeline) as
    | Record<string, { dependsOn?: string[]; outputs?: string[]; cache?: boolean; persistent?: boolean }>
    | undefined;
  if (tasks == null || typeof tasks !== "object") return [];
  const seen = new Map<string, string>();
  for (const [key, task] of Object.entries(tasks)) {
    const name = key.includes("#") ? key.slice(key.indexOf("#") + 1) : key;
    if (seen.has(name)) continue;
    const notes = [
      task?.persistent ? "long-running" : undefined,
      task?.cache === false ? "not cached" : undefined,
      task?.dependsOn?.length ? `after ${task.dependsOn.join(", ")}` : undefined,
    ].filter(Boolean);
    seen.set(name, notes.length > 0 ? `turbo task: ${notes.join(", ")}` : "turbo task");
  }
  return [...seen.entries()].map(([name, description]) => ({ name, description, priority: 75 }));
};

const workspaceGenerator: Fig.Generator = {
  // scoped names like @scope/web contain a slash; match on the whole word, not on the part after the slash
  getQueryTerm: (token: string) => token,
  custom: async (_tokens, _execute, context) => {
    const cwd = context.currentWorkingDirectory;
    const packages = await workspacePackages(cwd);
    return packages.map((p) => ({ name: p.name, description: `workspace package · ${path.relative(cwd, p.dir) || "."}`, priority: 75 }));
  },
};

const turboTaskGenerator: Fig.Generator = {
  custom: async (_tokens, _execute, context) => turboTasks(context.currentWorkingDirectory),
};

type SpecNode = { name?: Fig.SingleOrArray<string>; options?: SpecNode[]; subcommands?: SpecNode[]; args?: Fig.SingleOrArray<Fig.Arg> };

const namesOf = (node: SpecNode): string[] => (node.name == null ? [] : Array.isArray(node.name) ? node.name : [node.name]);

const walk = (node: SpecNode, visit: (n: SpecNode, kind: "option" | "subcommand") => void) => {
  for (const option of node.options ?? []) visit(option, "option");
  for (const sub of node.subcommands ?? []) {
    visit(sub, "subcommand");
    walk(sub, visit);
  }
};

const addGenerator = (node: SpecNode, generator: Fig.Generator) => {
  const first = Array.isArray(node.args) ? node.args.at(0) : node.args;
  const arg: Fig.Arg = first ?? { name: "package" };
  const existing = arg.generators == null ? [] : Array.isArray(arg.generators) ? arg.generators : [arg.generators];
  if (existing.includes(generator)) return;
  (arg as { generators?: Fig.Generator[] }).generators = [generator, ...existing];
  if (first == null) node.args = arg;
};

const patched = new WeakSet<object>();

export const augmentSpec = <T extends Fig.Spec | undefined>(command: string, spec: T): T => {
  if (spec == null || typeof spec !== "object" || patched.has(spec)) return spec;
  patched.add(spec);
  const root = spec as unknown as SpecNode;
  const optionNames: Record<string, string[]> = { pnpm: ["--filter", "-F"], turbo: ["--filter", "-F", "--scope"], npm: ["--workspace", "-w"] };
  const wanted = optionNames[command];
  try {
    if (wanted != null) {
      const visit = (node: SpecNode, kind: "option" | "subcommand") => {
        if (kind === "option" && namesOf(node).some((n) => wanted.includes(n))) addGenerator(node, workspaceGenerator);
      };
      for (const option of root.options ?? []) visit(option, "option");
      walk(root, visit);
    }
    // the upstream specs only know --filter on a few pnpm subcommands and not at all for turbo 2;
    // `pnpm --filter web dev` and `turbo run build --filter web` need it
    const filterOption = (): SpecNode =>
      ({
        name: ["--filter", "-F"],
        description: "Run only in the matching workspace packages",
        isPersistent: true,
        args: { name: "package", generators: [workspaceGenerator] },
      }) as SpecNode;
    const ensureFilter = (node: SpecNode | undefined) => {
      if (node != null && !(node.options ?? []).some((o) => namesOf(o).includes("--filter"))) node.options = [...(node.options ?? []), filterOption()];
    };
    if (command === "pnpm") ensureFilter(root);
    if (command === "turbo") {
      ensureFilter(root);
      ensureFilter(root.subcommands?.find((s) => namesOf(s).includes("run")));
    }
    if (command === "yarn") {
      const workspace = root.subcommands?.find((s) => namesOf(s).includes("workspace"));
      if (workspace != null) addGenerator(workspace, workspaceGenerator);
    }
    if (command === "turbo") {
      const run = root.subcommands?.find((s) => namesOf(s).includes("run"));
      if (run != null) {
        const arg = (Array.isArray(run.args) ? run.args.at(0) : run.args) ?? { name: "tasks", isVariadic: true };
        (arg as { generators?: Fig.Generator }).generators = turboTaskGenerator; // the upstream one only knows turbo 1
        run.args = arg;
      }
    }
    augmentMore(command, root);
  } catch (e) {
    log.debug({ msg: "could not add project suggestions to spec", command, e: (e as Error).message });
  }
  return spec;
};

const subOf = (node: SpecNode | undefined, ...path: string[]): SpecNode | undefined => {
  let current = node;
  for (const part of path) current = current?.subcommands?.find((s) => namesOf(s).includes(part));
  return current;
};

const raisedScripts = new WeakSet<Fig.Generator>();

// --context, --kubeconfig and the namespace typed on the line, for the kubectl calls behind the lists. The word being
// typed (the last one) is not a value yet.
export const kubectlLineFlags = (tokens: string[]): { context: string[]; namespace: string[] } => {
  const context: string[] = [];
  const namespace: string[] = [];
  const done = tokens.slice(0, -1);
  for (let i = 0; i < done.length; i++) {
    const t = done[i];
    const next = i + 1 < done.length ? done[i + 1] : undefined;
    const [flag, inline] = t.startsWith("--") && t.includes("=") ? [t.slice(0, t.indexOf("=")), t.slice(t.indexOf("=") + 1)] : [t, undefined];
    if (flag === "--context" || flag === "--kubeconfig") {
      const value = inline ?? next;
      if (value) context.push(`${flag}=${value}`);
      if (inline == null) i++;
    } else if (flag === "-n" || flag === "--namespace") {
      const value = inline ?? next;
      if (value) namespace.splice(0, namespace.length, `--namespace=${value}`);
      if (inline == null) i++;
    } else if (/^-n[^-]/.test(t)) {
      namespace.splice(0, namespace.length, `--namespace=${t.slice(2)}`);
    } else if (t === "-A" || t === "--all-namespaces") {
      namespace.splice(0, namespace.length, "--all-namespaces");
    }
  }
  return { context, namespace };
};

const kubectlNamespaces: Fig.Generator = {
  script: ["kubectl", "get", "namespaces", "-o", "custom-columns=:.metadata.name"],
  postProcess: (out) =>
    out
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("error:") && !line.includes("The connection to the server"))
      .map((name) => ({ name, description: "namespace" })),
};

const followedKubectl = new WeakSet<Fig.Generator>();

// The names in kubectl's lists come from the cluster. They follow the context and namespace typed on the line, and
// they are not kept between commands: withfig kept them for an hour, so after `kubectl config use-context staging`
// the list still showed the pods of the cluster before. Within one line they are asked for once.
const kubectlFollowsTheLine = (root: SpecNode) => {
  const follow = (generator: Fig.Generator) => {
    if (followedKubectl.has(generator) || generator.script == null || typeof generator.script === "string") return;
    const script = generator.script;
    generator.script = ((tokens: string[]) => {
      const base = typeof script === "function" ? script(tokens) : script;
      if (!Array.isArray(base) || base[0] !== "kubectl") return base;
      const { context, namespace } = kubectlLineFlags(tokens);
      const own = context.filter((flag) => !base.some((part) => part.startsWith(flag.slice(0, flag.indexOf("=") + 1))));
      return ["kubectl", ...own, ...(base[1] === "config" ? [] : namespace), ...base.slice(1)];
    }) as Fig.Generator["script"];
    delete (generator as { cache?: unknown }).cache;
    followedKubectl.add(generator);
  };
  const seen = new Set<object>();
  const walk = (node: SpecNode) => {
    if (seen.has(node)) return;
    seen.add(node);
    for (const option of node.options ?? []) {
      const names = namesOf(option);
      if (names.includes("--namespace") || (names.includes("-n") && names.length === 1)) {
        const arg = (Array.isArray(option.args) ? option.args.at(0) : option.args) ?? ({ name: "namespace" } as Fig.Arg);
        if (arg.generators == null) (arg as { generators?: Fig.Generator }).generators = kubectlNamespaces;
        if (option.args == null) option.args = arg;
      }
      walk(option);
    }
    for (const sub of node.subcommands ?? []) walk(sub);
    for (const arg of node.args == null ? [] : Array.isArray(node.args) ? node.args : [node.args]) {
      const generators = arg.generators == null ? [] : Array.isArray(arg.generators) ? arg.generators : [arg.generators];
      generators.forEach(follow);
    }
  };
  walk(root);
};

// puts a generator first on the first argument of a node (creating that argument when the spec has none)
const prepend = (node: SpecNode | undefined, generator: Fig.Generator, argName = "value", replace = false) => {
  if (node == null) return;
  const first = (Array.isArray(node.args) ? node.args.at(0) : node.args) ?? ({ name: argName, isOptional: true } as Fig.Arg);
  const existing = replace || first.generators == null ? [] : Array.isArray(first.generators) ? first.generators : [first.generators];
  if (existing.includes(generator)) return;
  (first as { generators?: Fig.Generator[] }).generators = [generator, ...existing];
  if (node.args == null) node.args = first;
  else if (Array.isArray(node.args)) node.args[0] = first;
  else node.args = first;
};

// git stashes, worktrees, reflog and aliases; ports and processes; project tasks; package versions
const augmentMore = (command: string, root: SpecNode) => {
  if (command === "git") augmentGit(root as Parameters<typeof augmentGit>[0]);
  if (command === "kill") {
    prepend(root, pidGenerator, "pid");
    // kill -9 <pid>: the signal written as an option, which the spec does not know
    const signals: [string[], string][] = [
      [["-9", "-KILL", "-SIGKILL"], "Stop at once, without letting the process clean up"],
      [["-15", "-TERM", "-SIGTERM"], "Ask the process to stop (the default)"],
      [["-2", "-INT", "-SIGINT"], "Interrupt, like Ctrl+C"],
      [["-1", "-HUP", "-SIGHUP"], "Hang up; many servers reload their config"],
    ];
    const known = new Set((root.options ?? []).flatMap(namesOf));
    for (const [names, description] of signals)
      if (!names.some((n) => known.has(n))) root.options = [...(root.options ?? []), { name: names, description, args: undefined } as SpecNode];
  }
  if (command === "kubectl") {
    // the flags kubectl takes before or after any subcommand, which the spec does not list
    const described = root as { description?: string };
    if (!described.description) described.description = "Controls Kubernetes clusters";
    const contexts: Fig.Generator = { script: ["kubectl", "config", "get-contexts", "-o", "name"], splitOn: "\n" };
    const globals: [string[], string, Fig.Arg][] = [
      [["--context"], "The kubeconfig context to use", { name: "context", generators: contexts }],
      [["--kubeconfig"], "The kubeconfig file to use", { name: "file", template: "filepaths" }],
      [["--cluster"], "The kubeconfig cluster to use", { name: "cluster" }],
      [["--user"], "The kubeconfig user to use", { name: "user" }],
      [["--as"], "Act as this user", { name: "user" }],
    ];
    const known = new Set((root.options ?? []).flatMap(namesOf));
    for (const [names, description, args] of globals)
      if (!names.some((n) => known.has(n))) root.options = [...(root.options ?? []), { name: names, description, args, isPersistent: true } as SpecNode];
    for (const option of root.options ?? []) if (namesOf(option).includes("--namespace")) (option as { isPersistent?: boolean }).isPersistent = true;
    kubectlFollowsTheLine(root);
  }
  if (command === "lsof") {
    const option = (root.options ?? []).find((o) => namesOf(o).includes("-i"));
    if (option != null) prepend(option, portGenerator(":"), "address", true);
  }
  if (command === "make") {
    prepend(root, makeGenerator, "target", true);
    const first = (Array.isArray(root.args) ? root.args.at(0) : root.args) as { isVariadic?: boolean } | undefined;
    if (first != null) first.isVariadic = true; // make build test lint
  }
  if (command === "deno") prepend(subOf(root, "task"), denoTaskGenerator, "task");
  if (command === "just") prepend(root, justGenerator, "recipe");
  if (command === "task") prepend(root, taskGenerator, "task");
  if (command === "mise") {
    for (const node of [subOf(root, "run"), subOf(root, "r"), subOf(root, "tasks", "run")]) prepend(node, miseGenerator, "task");
  }
  if (command === "docker" || command === "docker-compose") {
    const compose = command === "docker" ? subOf(root, "compose") : root;
    for (const name of composeSubcommands) {
      const node = subOf(compose, name);
      const first = (Array.isArray(node?.args) ? node?.args.at(0) : node?.args) as Fig.Arg | undefined;
      if (first?.generators != null) {
        const list = Array.isArray(first.generators) ? first.generators : [first.generators];
        first.generators = list.map((g) => composeFallback(g, executeGenerator));
      }
      prepend(node, composeGenerator, "service");
    }
  }
  if (command === "bun") {
    // `bun run` takes a script or a file; the scripts of package.json come before the folders
    const run = subOf(root, "run");
    const arg = (Array.isArray(run?.args) ? run?.args.at(0) : run?.args) as Fig.Arg | undefined;
    for (const generator of arg?.generators == null ? [] : Array.isArray(arg.generators) ? arg.generators : [arg.generators]) {
      const original = generator.postProcess;
      if (original == null || raisedScripts.has(generator) || !JSON.stringify(generator.script ?? "").includes("package.json")) continue;
      raisedScripts.add(generator);
      generator.postProcess = (out, tokens) => original(out, tokens).map((s) => ({ ...s, priority: Math.max(s.priority ?? 50, 76) }));
    }
  }
  const installs: Record<string, string[]> = { npm: ["install", "i", "add"], pnpm: ["add", "install", "i"], yarn: ["add"], bun: ["add", "install", "i"] };
  for (const name of installs[command] ?? []) prepend(subOf(root, name), versionGenerator, "package");
};

// git: "Remote branch" becomes "Remote branch · 2 days ago · fix login redirect"
const branchCache = new Map<string, { at: number; info: Map<string, string> }>();

const branchInfo = (cwd: string): Promise<Map<string, string>> => {
  const cached = branchCache.get(cwd);
  if (cached != null && Date.now() - cached.at < 10_000) return Promise.resolve(cached.info);
  return new Promise((resolve) => {
    execFile(
      "git",
      ["for-each-ref", "--format=%(refname:short)%09%(committerdate:relative)%09%(contents:subject)", "refs/heads", "refs/remotes"],
      { cwd, timeout: 2000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        const info = new Map<string, string>();
        if (error == null) {
          for (const line of stdout.split("\n")) {
            const [ref, age, subject] = line.split("\t");
            if (!ref || !age) continue;
            const note = subject ? `${age} · ${subject}` : age;
            info.set(ref, note);
            const local = ref.replace(/^[^/]+\//, "");
            if (ref !== local && !info.has(local)) info.set(local, note);
          }
        }
        branchCache.set(cwd, { at: Date.now(), info });
        resolve(info);
      },
    );
  });
};

export const enrichSuggestions = async (command: string, suggestions: Suggestion[], cwd: string): Promise<void> => {
  if (command !== "git" || suggestions.length === 0) return;
  const info = await branchInfo(cwd);
  if (info.size === 0) return;
  for (const s of suggestions) {
    if (s.type === "subcommand" || s.type === "option" || s.icon === SuggestionIcons.Subcommand || s.icon === SuggestionIcons.Option || s.name.startsWith("-"))
      continue;
    const note = info.get(s.name);
    if (note == null) continue;
    s.description = s.description ? `${s.description} · ${note}` : note;
  }
};
