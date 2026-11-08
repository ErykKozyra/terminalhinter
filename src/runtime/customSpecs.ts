// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// Your own suggestions in plain YAML or JSON, no TypeScript needed. Every file in ~/.config/terminalhinter/specs
// describes one command:
//
//   name: deploy
//   description: Deploy our apps
//   subcommands:
//     - name: staging
//       args: { name: app, suggestions: [web, admin] }
//     - name: prod
//       args: { name: app, script: "ls apps" }   # each output line is a suggestion; "name<TAB>description" works too
//   options:
//     - name: [--force, -f]
//       description: Skip the checks
//
// `template: filepaths` or `template: folders` on args suggests files or folders.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";

import { xdgConfigHome } from "../utils/constants.js";
import log from "../utils/log.js";

export const customSpecsFolder = () => process.env.THINT_SPECS_DIR ?? path.join(xdgConfigHome ?? path.join(os.homedir(), ".config"), "terminalhinter", "specs");

type RawNode = {
  name?: string | string[];
  description?: string;
  subcommands?: RawNode[];
  options?: RawNode[];
  args?: RawArg | RawArg[];
  priority?: number;
  hidden?: boolean;
  isPersistent?: boolean;
  isRequired?: boolean;
};
type RawArg = {
  name?: string;
  description?: string;
  suggestions?: (string | { name: string | string[]; description?: string })[];
  script?: string;
  template?: "filepaths" | "folders" | ("filepaths" | "folders")[];
  isOptional?: boolean;
  isVariadic?: boolean;
};

const scriptGenerator = (script: string): Fig.Generator => ({
  script: ["sh", "-c", script],
  postProcess: (out: string) =>
    out
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0)
      .map((line) => {
        const [name, ...rest] = line.split("\t");
        return rest.length > 0 ? { name, description: rest.join(" ") } : { name };
      }),
});

// YAML reads `3000` or `true` as a number or a boolean, and `~` as nothing; names are text, so `ports: [3000, 8080]`
// works and an empty entry is left out
const text = (value: unknown): string | undefined =>
  typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : undefined;
const names = (value: unknown): string | string[] | undefined => {
  if (!Array.isArray(value)) return text(value);
  const list = value.map(text).filter((n): n is string => n != null);
  return list.length > 0 ? list : undefined;
};

const toArg = (raw: RawArg): Fig.Arg => {
  const arg: Fig.Arg = { name: raw.name, description: raw.description, isOptional: raw.isOptional, isVariadic: raw.isVariadic };
  if (raw.suggestions != null)
    arg.suggestions = (Array.isArray(raw.suggestions) ? raw.suggestions : [raw.suggestions])
      .map((s): Fig.Suggestion | undefined => {
        if (s != null && typeof s === "object" && !Array.isArray(s)) {
          const name = names(s.name);
          return name == null ? undefined : { ...s, name };
        }
        const name = text(s);
        return name == null ? undefined : { name };
      })
      .filter((s): s is Fig.Suggestion => s != null);
  if (raw.script != null) arg.generators = scriptGenerator(raw.script);
  if (raw.template != null) arg.template = raw.template;
  return arg;
};

const toNode = (raw: RawNode): Fig.Subcommand => {
  if (raw == null || typeof raw !== "object") throw new Error("every command, subcommand and option needs a name");
  const name = names(raw.name);
  if (name == null) throw new Error("every command, subcommand and option needs a name");
  const node: Fig.Subcommand = { name, description: raw.description, priority: raw.priority, hidden: raw.hidden };
  if (raw.subcommands != null) node.subcommands = raw.subcommands.map(toNode);
  if (raw.options != null) node.options = raw.options.map((o) => ({ ...toNode(o), isPersistent: o.isPersistent, isRequired: o.isRequired }) as Fig.Option);
  if (raw.args != null) node.args = Array.isArray(raw.args) ? raw.args.map(toArg) : toArg(raw.args);
  return node;
};

export const parseCustomSpec = (text: string, file: string): Fig.Spec => {
  const raw = (file.endsWith(".json") ? JSON.parse(text) : YAML.parse(text)) as RawNode;
  if (raw == null || typeof raw !== "object") throw new Error("the file is empty");
  return toNode(raw) as Fig.Spec;
};

export type CustomSpecError = { file: string; message: string };

// Reads every spec file; a broken file is skipped and reported, it never stops the others or the session.
export const loadCustomSpecs = (): { specs: Map<string, Fig.Spec>; errors: CustomSpecError[] } => {
  const specs = new Map<string, Fig.Spec>();
  const errors: CustomSpecError[] = [];
  const folder = customSpecsFolder();
  let files: string[] = [];
  try {
    files = fs.readdirSync(folder).filter((f) => /\.(ya?ml|json)$/.test(f));
  } catch {
    return { specs, errors };
  }
  for (const file of files.sort()) {
    const full = path.join(folder, file);
    try {
      const spec = parseCustomSpec(fs.readFileSync(full, "utf8"), full);
      const names = Array.isArray(spec.name) ? spec.name : [spec.name];
      for (const name of names) specs.set(name, spec);
    } catch (e) {
      errors.push({ file: full, message: (e as Error).message });
      log.debug({ msg: "skipped a custom spec", file: full, e: (e as Error).message });
    }
  }
  return { specs, errors };
};
