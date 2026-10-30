// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import { getConfig } from "../utils/config.js";

export type Theme = {
  description: string;
  selection: string; // background of the selected row
  selectionText: string; // text on the selected row
  border: string;
  match: string; // the part of a name you already typed
  args: string; // argument hints like [branch]
  argsSelected: string;
  footer: string; // description under the list
  counter: string; // 3/12
  icons: { execute: string; folder: string; file: string; subcommand: string; option: string; star: string; value: string; alias: string };
};

export const themes = {
  thint: {
    description: "default, for dark terminals",
    selection: "#2F5FD0",
    selectionText: "#FFFFFF",
    border: "#4B5263",
    match: "#F5C451",
    args: "#7F8796",
    argsSelected: "#C7D2FE",
    footer: "#9AA3B2",
    counter: "#6B7280",
    icons: {
      execute: "#E5484D",
      folder: "#4C9AFF",
      file: "#8B95A7",
      subcommand: "#8E5CF5",
      option: "#E8862E",
      star: "#D9A21B",
      value: "#2F9E6E",
      alias: "#22B8CF",
    },
  },
  light: {
    description: "for light terminals",
    selection: "#D6E4FF",
    selectionText: "#0B1F44",
    border: "#B8C0CC",
    match: "#B45309",
    args: "#6B7280",
    argsSelected: "#334155",
    footer: "#475569",
    counter: "#64748B",
    icons: {
      execute: "#DC2626",
      folder: "#2563EB",
      file: "#64748B",
      subcommand: "#7C3AED",
      option: "#C2410C",
      star: "#B7791F",
      value: "#15803D",
      alias: "#0E7490",
    },
  },
  nord: {
    description: "cool arctic blues",
    selection: "#5E81AC",
    selectionText: "#ECEFF4",
    border: "#4C566A",
    match: "#EBCB8B",
    args: "#7B88A1",
    argsSelected: "#D8DEE9",
    footer: "#81A1C1",
    counter: "#616E88",
    icons: {
      execute: "#BF616A",
      folder: "#88C0D0",
      file: "#D8DEE9",
      subcommand: "#B48EAD",
      option: "#D08770",
      star: "#EBCB8B",
      value: "#A3BE8C",
      alias: "#8FBCBB",
    },
  },
  dracula: {
    description: "vivid purple and pink",
    selection: "#6272A4",
    selectionText: "#F8F8F2",
    border: "#44475A",
    match: "#F1FA8C",
    args: "#7A80A6",
    argsSelected: "#E2E4F3",
    footer: "#A9ACC0",
    counter: "#6272A4",
    icons: {
      execute: "#FF5555",
      folder: "#8BE9FD",
      file: "#F8F8F2",
      subcommand: "#BD93F9",
      option: "#FFB86C",
      star: "#F1FA8C",
      value: "#50FA7B",
      alias: "#FF79C6",
    },
  },
} satisfies Record<string, Theme>;

export type ThemeName = keyof typeof themes;
export const themeNames = Object.keys(themes) as ThemeName[];

// The configured theme, with `activeSuggestionBackgroundColor` and `borderColor` from the config on top when set.
export const activeTheme = (): Theme => {
  const config = getConfig();
  const base: Theme = themes[config.theme as ThemeName] ?? themes.thint;
  return {
    ...base,
    selection: config.activeSuggestionBackgroundColor ?? base.selection,
    border: config.borderColor ?? base.border,
  };
};
