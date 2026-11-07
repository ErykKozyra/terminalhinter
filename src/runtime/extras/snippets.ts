// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// Your own command templates with fields to fill, in ~/.config/terminalhinter/snippets.yaml:
//
//   - name: release
//     description: Tag a version and push it
//     command: git tag v{{version}} && git push origin v{{version}}
//
// Typing the start of the name offers the snippet; accepting it asks for each field in the list ({{port:3000}} has
// 3000 as its default) and then puts the finished command on the line, without running it.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";

export type Snippet = { name: string; command: string; description?: string };
export type Field = { name: string; default?: string };

const xdgConfigHome = process.env.XDG_CONFIG_HOME;
export const snippetsFile = () =>
  process.env.THINT_SNIPPETS_FILE ?? path.join(xdgConfigHome ?? path.join(os.homedir(), ".config"), "terminalhinter", "snippets.yaml");

let cache: { mtime: number; snippets: Snippet[]; error?: string } | undefined;

export const loadSnippets = (): { snippets: Snippet[]; error?: string } => {
  const file = snippetsFile();
  let mtime = -1;
  try {
    mtime = fs.statSync(file).mtimeMs;
  } catch {
    return { snippets: [] };
  }
  if (cache?.mtime === mtime) return cache;
  try {
    const doc = YAML.parse(fs.readFileSync(file, "utf8")) as unknown;
    const list = Array.isArray(doc) ? doc : Array.isArray((doc as { snippets?: unknown })?.snippets) ? (doc as { snippets: unknown[] }).snippets : [];
    const snippets = list
      .filter((s): s is Snippet => s != null && typeof (s as Snippet).name === "string" && typeof (s as Snippet).command === "string")
      .map((s) => ({ name: s.name.trim(), command: s.command.trim(), description: typeof s.description === "string" ? s.description : undefined }));
    cache = { mtime, snippets };
  } catch (e) {
    cache = { mtime, snippets: [], error: (e as Error).message };
  }
  return cache;
};

const fieldPattern = /\{\{\s*([A-Za-z_][\w-]*)\s*(?::([^}]*))?\}\}/g;

// each field once, in the order it first appears
export const snippetFields = (command: string): Field[] => {
  const seen = new Map<string, Field>();
  for (const m of command.matchAll(fieldPattern)) if (!seen.has(m[1])) seen.set(m[1], { name: m[1], default: m[2]?.trim() || undefined });
  return [...seen.values()];
};

// a field used twice takes its default from wherever it is given
export const fillSnippet = (command: string, values: Record<string, string>): string => {
  const defaults = new Map(snippetFields(command).map((f) => [f.name, f.default]));
  return command.replace(fieldPattern, (_, name: string, fallback?: string) => values[name] || fallback?.trim() || defaults.get(name) || "");
};

// how the snippet reads in the list: fields shown as <name>
export const previewSnippet = (command: string): string => command.replace(fieldPattern, (_, name: string) => `<${name}>`);

export const exampleSnippets = `# terminalhinter snippets: type the start of a name, accept it, fill the fields.
# {{field}} asks for a value, {{field:default}} has a default. Nothing runs until you press Enter.
- name: release
  description: Tag a version and push the tag
  command: git tag v{{version}} && git push origin v{{version}}
- name: freeport
  description: Stop whatever listens on a port
  command: kill $(lsof -ti :{{port:3000}})
- name: wip
  description: Commit everything as work in progress
  command: git add -A && git commit -m "wip: {{what}}"
`;
