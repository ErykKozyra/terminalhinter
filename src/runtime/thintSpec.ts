// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// Suggestions for terminalhinter's own commands, so `thint ` lists them and `thint theme ` lists the themes.

import { readBookmarks } from "./jumps.js";
import { describeKey, settableKeys } from "../utils/configWriter.js";
import { configSchema } from "../utils/config.js";
import { initSupportedShells } from "../utils/shell.js";
import { themeNames, themes } from "../ui/theme.js";

const themeArg: Fig.Arg = {
  name: "theme",
  isOptional: true,
  suggestions: themeNames.map((name) => ({ name, description: themes[name].description })),
};

const keyArg: Fig.Arg = {
  name: "key",
  suggestions: settableKeys.map((key) => ({ name: key, description: describeKey(key) })),
};

// values allowed for the key typed before them: enum values, true/false, or nothing to suggest
const valueArg: Fig.Arg = {
  name: "value",
  generators: {
    custom: async (tokens) => {
      // the key is the word right after `set`, whether or not the value is being typed yet
      const key = tokens[tokens.lastIndexOf("set") + 1] ?? "";
      const property = (configSchema.properties as unknown as Record<string, { type: string; enum?: string[] }>)[key];
      if (property == null) return [];
      if (property.enum)
        return property.enum.map((name) => ({ name, description: key === "theme" ? themes[name as keyof typeof themes]?.description : undefined }));
      if (property.type === "boolean") return [{ name: "true" }, { name: "false" }];
      return [];
    },
  },
};

const bookmarkArg: Fig.Arg = {
  name: "name-or-folder",
  generators: { custom: async () => readBookmarks().map((b) => ({ name: b.name, description: b.path })) },
};

export const thintSpec: Fig.Subcommand = {
  name: "thint",
  description: "terminalhinter: autocomplete in your terminal",
  subcommands: [
    {
      name: "init",
      description: "Guided setup: shell, theme, icons",
      args: { name: "shell", isOptional: true, suggestions: initSupportedShells.map((s) => String(s)) },
    },
    {
      name: "theme",
      description: "Pick the colors of the dropdown",
      args: themeArg,
      options: [{ name: ["-l", "--list"], description: "Print every theme with a preview" }],
    },
    {
      name: "config",
      description: "Show or change settings",
      subcommands: [
        { name: ["list", "ls"], description: "Every setting and its value" },
        { name: "get", description: "Print one setting", args: keyArg },
        { name: "set", description: "Change one setting", args: [keyArg, valueArg] },
        { name: "unset", description: "Back to the default of one setting", args: keyArg },
        { name: "path", description: "Where the config file is" },
      ],
    },
    {
      name: "bookmark",
      description: "Folders `cd` offers from anywhere",
      subcommands: [
        {
          name: "add",
          description: "Bookmark a folder",
          args: { name: "folder", isOptional: true, template: "folders" },
          options: [{ name: ["-n", "--name"], description: "Name to type after cd", args: { name: "name" } }],
        },
        { name: "list", description: "Show your bookmarks" },
        { name: ["remove", "rm"], description: "Remove a bookmark", args: bookmarkArg },
      ],
    },
    {
      name: "specs",
      description: "Your own suggestions in YAML",
      subcommands: [
        { name: "new", description: "Start a file for a command", args: { name: "command" } },
        { name: "check", description: "Find mistakes in your files" },
        { name: "list", description: "List the commands with suggestions" },
      ],
    },
    {
      name: "order",
      description: "Your own order of the list (Shift+Up / Shift+Down)",
      subcommands: [
        { name: "list", description: "Show the orders you set" },
        { name: "reset", description: "Forget an order", args: { name: "words", isOptional: true, isVariadic: true } },
      ],
    },
    { name: "doctor", description: "Check the installation" },
    { name: "update", description: "Install the newest version", options: [{ name: ["-f", "--force"], description: "Install again even when up to date" }] },
    { name: "reinit", description: "Regenerate resources after an update" },
    { name: "uninstall", description: "Remove resources and settings" },
  ],
  options: [
    { name: ["-c", "--check"], description: "Is this shell running inside terminalhinter?" },
    { name: ["-s", "--shell"], description: "Shell to start", args: { name: "shell", suggestions: initSupportedShells.map((s) => String(s)) } },
    { name: ["-l", "--login"], description: "Start the shell as a login shell" },
    { name: ["-V", "--verbose"], description: "Verbose logging" },
    { name: ["-v", "--version"], description: "Print the version" },
    { name: ["-h", "--help"], description: "Show help" },
  ],
};
