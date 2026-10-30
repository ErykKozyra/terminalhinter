// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// Changes one top-level setting in the config file and leaves everything else (comments, other keys, [sections])
// as it was. Used by `thint config set`, `thint theme` and the `thint init` wizard.

import fs from "node:fs";
import path from "node:path";
import toml from "toml";
import _Ajv from "ajv";
import { configSchema, rcPath, configPaths } from "./config.js";

const Ajv = _Ajv as unknown as typeof _Ajv.default;
const ajv = new Ajv();

type SchemaProperty = { type: string; enum?: string[]; pattern?: string };
const properties = configSchema.properties as unknown as Record<string, SchemaProperty>;

// the settings that are a single value, so they can be set from the command line
export const settableKeys = Object.entries(properties)
  .filter(([, p]) => ["string", "boolean", "number"].includes(p.type))
  .map(([key]) => key);

export const describeKey = (key: string): string => {
  const p = properties[key];
  if (p == null) return "";
  if (p.enum) return p.enum.join(" | ");
  if (p.pattern?.includes("#")) return "#RRGGBB";
  return p.type;
};

export const parseValue = (key: string, raw: string): string | number | boolean => {
  const p = properties[key];
  if (p == null || !settableKeys.includes(key)) throw new Error(`unknown setting '${key}', settable: ${settableKeys.join(", ")}`);
  if (p.type === "boolean") {
    if (raw === "true" || raw === "false") return raw === "true";
    throw new Error(`${key} must be true or false`);
  }
  if (p.type === "number") {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`${key} must be a number`);
    return n;
  }
  return raw;
};

// the file thint reads: the first one that exists, otherwise ~/.terminalhinterrc
export const activeConfigPath = (): string => configPaths.find((p) => fs.existsSync(p)) ?? rcPath;

const formatValue = (value: string | number | boolean) => (typeof value === "string" ? JSON.stringify(value) : String(value));

export const setInToml = (text: string, key: string, value: string | number | boolean | undefined): string => {
  const lines = text.length > 0 ? text.split("\n") : [];
  const firstSection = lines.findIndex((l) => /^\s*\[/.test(l));
  const end = firstSection === -1 ? lines.length : firstSection;
  const keyPattern = new RegExp(`^\\s*${key}\\s*=`);
  const existing = lines.slice(0, end).findIndex((l) => keyPattern.test(l));
  const line = value === undefined ? undefined : `${key} = ${formatValue(value)}`;
  if (existing !== -1) {
    if (line === undefined) lines.splice(existing, 1);
    else lines[existing] = line;
  } else if (line !== undefined) {
    // top-level keys have to come before the first [section], otherwise TOML puts them inside it
    let at = end;
    while (at > 0 && lines[at - 1].trim() === "") at--;
    lines.splice(at, 0, line);
  }
  let result = lines.join("\n");
  if (!result.endsWith("\n")) result += "\n";
  return result;
};

// writes the setting and returns the file it went to; nothing is written if the result would be invalid
export const writeSetting = (key: string, value: string | number | boolean | undefined, file = activeConfigPath()): string => {
  const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const after = setInToml(before, key, value);
  let parsed: unknown;
  try {
    parsed = toml.parse(after);
  } catch (e) {
    throw new Error(`${file} is not valid toml, fix it first (${(e as Error).message})`);
  }
  if (!ajv.validate(configSchema, parsed)) throw new Error(`invalid value for ${key}: ${ajv.errorsText()}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, after);
  return file;
};
