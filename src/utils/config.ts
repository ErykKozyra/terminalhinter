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
type IconStyle = "plain" | "marks" | "badge";
export const themeNameList = ["thint", "light", "nord", "dracula"] as const;
type ThemeName = (typeof themeNameList)[number];

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
  maxSuggestions?: number;
  activeSuggestionBackgroundColor?: string;
  boxBorderStyle: BoxBorderStyle;
  borderColor?: string;
  theme: ThemeName;
  enterAcceptsSuggestion: boolean;
  iconStyle: IconStyle;
  fuzzyMatching: boolean;
  showHints: boolean;
  boxBackground: boolean;
  argumentHints: "selected" | "all" | "none";
  updateCheck: boolean;
  tabBehavior: "accept" | "shell";
  showListOn: "typing" | "tab";
  fixSuggestions: boolean;
  enterRuns: boolean;
  historyEntries: boolean;
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

export const configSchema = {
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
    maxSuggestions: {
      type: "number",
      nullable: true,
      default: 6,
    },
    activeSuggestionBackgroundColor: {
      type: "string",
      nullable: true,
      pattern: "^#[0-9A-Fa-f]{6}$",
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
    },
    theme: {
      type: "string",
      nullable: true,
      enum: [...themeNameList],
      default: "thint",
    },
    enterAcceptsSuggestion: {
      type: "boolean",
      nullable: true,
      default: true,
    },
    iconStyle: {
      type: "string",
      nullable: true,
      enum: ["plain", "marks", "badge"],
      default: "plain",
    },
    fuzzyMatching: {
      type: "boolean",
      nullable: true,
      default: true,
    },
    showHints: {
      type: "boolean",
      nullable: true,
      default: true,
    },
    boxBackground: {
      type: "boolean",
      nullable: true,
      default: true,
    },
    argumentHints: {
      type: "string",
      nullable: true,
      enum: ["selected", "all", "none"],
      default: "selected",
    },
    updateCheck: {
      type: "boolean",
      nullable: true,
      default: true,
    },
    tabBehavior: {
      type: "string",
      nullable: true,
      enum: ["accept", "shell"],
      default: "accept",
    },
    showListOn: {
      type: "string",
      nullable: true,
      enum: ["typing", "tab"],
      default: "typing",
    },
    enterRuns: {
      type: "boolean",
      nullable: true,
      default: false,
    },
    fixSuggestions: {
      type: "boolean",
      nullable: true,
      default: true,
    },
    historyEntries: {
      type: "boolean",
      nullable: true,
      default: true,
    },
  },
  additionalProperties: false,
};

const rcFile = ".terminalhinterrc";
export const rcPath = path.join(os.homedir(), rcFile);

export const configPaths = [rcPath, xdgConfigPath];

// `thint theme` and `thint init` preview a setting without writing it
export const overrideConfig = (patch: Partial<Config>) => {
  globalConfig = { ...globalConfig, ...patch };
};

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
  boxBorderStyle: "rounded",
  theme: "thint",
  enterAcceptsSuggestion: true,
  iconStyle: "plain",
  fuzzyMatching: true,
  showHints: true,
  boxBackground: true,
  argumentHints: "selected",
  updateCheck: true,
  tabBehavior: "accept",
  showListOn: "typing",
  fixSuggestions: true,
  enterRuns: false,
  historyEntries: true,
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
      // the Nerd Font style is gone: a config that still asks for it (or for the old useNerdFont) gets the default look
      // instead of being thrown away as invalid
      const legacy = config as Record<string, unknown> | undefined;
      if (legacy?.iconStyle === "nerd") delete legacy.iconStyle;
      if (legacy != null && "useNerdFont" in legacy) delete legacy.useNerdFont;
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
        maxSuggestions: config?.maxSuggestions ?? 6,
        activeSuggestionBackgroundColor: config?.activeSuggestionBackgroundColor,
        boxBorderStyle: config?.boxBorderStyle ?? "rounded",
        borderColor: config?.borderColor,
        theme: config?.theme ?? "thint",
        enterAcceptsSuggestion: config?.enterAcceptsSuggestion ?? true,
        iconStyle: config?.iconStyle ?? "plain",
        fuzzyMatching: config?.fuzzyMatching ?? true,
        showHints: config?.showHints ?? true,
        boxBackground: config?.boxBackground ?? true,
        argumentHints: config?.argumentHints ?? "selected",
        updateCheck: config?.updateCheck ?? true,
        tabBehavior: config?.tabBehavior ?? "accept",
        showListOn: config?.showListOn ?? "typing",
        fixSuggestions: config?.fixSuggestions ?? true,
        enterRuns: config?.enterRuns ?? false,
        historyEntries: config?.historyEntries ?? true,
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
