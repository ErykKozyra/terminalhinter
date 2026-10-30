// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import fsAsync from "node:fs/promises";
import toml from "toml";
import _Ajv, { JSONSchemaType } from "ajv";
import { Command } from "commander";
import { allResourcesPath, xdgConfigPath } from "./constants.js";

const Ajv = _Ajv as unknown as typeof _Ajv.default;
const ajv = new Ajv();

type Binding = {
  shift?: boolean;
  control?: boolean;
  key: string;
};

type BoxBorderStyle = "square" | "rounded";
type IconStyle = "plain" | "badge" | "nerd";

type Config = {
  bindings: {
    nextSuggestion: Binding;
    previousSuggestion: Binding;
    dismissSuggestions: Binding;
    acceptSuggestion: Binding;
  };
  specs: {
    path: string[];
  };
  useAliases: boolean;
  useNerdFont: boolean;
  maxSuggestions?: number;
  activeSuggestionBackgroundColor: string;
  boxBorderStyle: BoxBorderStyle;
  borderColor: string;
  enterAcceptsSuggestion: boolean;
  iconStyle: IconStyle;
  fuzzyMatching: boolean;
};

const bindingSchema: JSONSchemaType<Binding> = {
  type: "object",
  nullable: true,
  properties: {
    shift: { type: "boolean", nullable: true },
    control: { type: "boolean", nullable: true },
    key: { type: "string" },
  },
  required: ["key"],
};

const specPathsSchema: JSONSchemaType<string[]> = {
  type: "array",
  items: { type: "string" },
  nullable: true,
};

const configSchema = {
  type: "object",
  nullable: true,
  properties: {
    bindings: {
      type: "object",
      nullable: true,
      properties: {
        nextSuggestion: bindingSchema,
        previousSuggestion: bindingSchema,
        dismissSuggestions: bindingSchema,
        acceptSuggestion: bindingSchema,
      },
    },
    specs: {
      type: "object",
      nullable: true,
      properties: {
        path: specPathsSchema,
      },
    },
    useAliases: {
      type: "boolean",
      nullable: true,
      default: true,
    },
    useNerdFont: {
      type: "boolean",
      nullable: true,
      default: false,
    },
    maxSuggestions: {
      type: "number",
      nullable: true,
      default: 6,
    },
    activeSuggestionBackgroundColor: {
      type: "string",
      nullable: true,
      pattern: "^#[0-9A-Fa-f]{6}$",
      default: "#2F5FD0",
    },
    boxBorderStyle: {
      type: "string",
      nullable: true,
      enum: ["square", "rounded"],
      default: "rounded",
    },
    borderColor: {
      type: "string",
      nullable: true,
      pattern: "^#[0-9A-Fa-f]{6}$",
      default: "#4B5263",
    },
    enterAcceptsSuggestion: {
      type: "boolean",
      nullable: true,
      default: true,
    },
    iconStyle: {
      type: "string",
      nullable: true,
      enum: ["plain", "badge", "nerd"],
      default: "plain",
    },
    fuzzyMatching: {
      type: "boolean",
      nullable: true,
      default: true,
    },
  },
  additionalProperties: false,
};

const rcFile = ".terminalhinterrc";
const rcPath = path.join(os.homedir(), rcFile);

const configPaths = [rcPath, xdgConfigPath];

let globalConfig: Config = {
  bindings: {
    nextSuggestion: { key: "down" },
    previousSuggestion: { key: "up" },
    acceptSuggestion: { key: "tab" },
    dismissSuggestions: { key: "escape" },
  },
  specs: {
    path: [],
  },
  useAliases: true,
  useNerdFont: false,
  activeSuggestionBackgroundColor: "#2F5FD0",
  boxBorderStyle: "rounded",
  borderColor: "#4B5263",
  enterAcceptsSuggestion: true,
  iconStyle: "plain",
  fuzzyMatching: true,
};

export const getConfig = (): Config => globalConfig;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const loadConfig = async (_program?: Command) => {
  for (const configPath of configPaths) {
    if (fs.existsSync(configPath)) {
      let config: Config;
      try {
        config = toml.parse((await fsAsync.readFile(configPath)).toString());
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        // a broken config must never take the terminal down with it: warn and keep the defaults
        process.stderr.write(`terminalhinter: ${configPath} is invalid toml (line ${e.line}, column ${e.column}: ${e.message}), using defaults\n`);
        continue;
      }
      const isValid = ajv.validate(configSchema, config);
      if (!isValid) {
        process.stderr.write(`terminalhinter: ${configPath} is invalid (${ajv.errorsText()}), using defaults\n`);
        continue;
      }
      globalConfig = {
        bindings: {
          nextSuggestion: config?.bindings?.nextSuggestion ?? globalConfig.bindings.nextSuggestion,
          previousSuggestion: config?.bindings?.previousSuggestion ?? globalConfig.bindings.previousSuggestion,
          acceptSuggestion: config?.bindings?.acceptSuggestion ?? globalConfig.bindings.acceptSuggestion,
          dismissSuggestions: config?.bindings?.dismissSuggestions ?? globalConfig.bindings.dismissSuggestions,
        },
        specs: {
          path: [...(config?.specs?.path ?? [])],
        },
        useAliases: config.useAliases ?? true,
        useNerdFont: config?.useNerdFont ?? false,
        maxSuggestions: config?.maxSuggestions ?? 6,
        activeSuggestionBackgroundColor: config?.activeSuggestionBackgroundColor ?? "#2F5FD0",
        boxBorderStyle: config?.boxBorderStyle ?? "rounded",
        borderColor: config?.borderColor ?? "#4B5263",
        enterAcceptsSuggestion: config?.enterAcceptsSuggestion ?? true,
        iconStyle: config?.iconStyle ?? (config?.useNerdFont ? "nerd" : "plain"),
        fuzzyMatching: config?.fuzzyMatching ?? true,
      };
    }
  }
  globalConfig.specs = { path: [path.join(os.homedir(), ".fig", "autocomplete", "build"), ...(globalConfig.specs?.path ?? [])] };
};

export const deleteCacheFolder = (): void => {
  if (fs.existsSync(allResourcesPath)) {
    fs.rmSync(allResourcesPath, { recursive: true });
  }
};
