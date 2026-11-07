// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandToken } from "./parser.js";

export type Suggestion = {
  name: string;
  allNames: string[];
  description?: string;
  icon: string;
  priority: number;
  insertValue?: string;
  type?: Fig.SuggestionType;
  hidden?: boolean;
  args?: string;
  execute?: boolean;
  // why this entry deserves care (deletes, force-pushes, looks like production); the list marks it red
  risk?: string;
  // a snippet from snippets.yaml: accepting it asks for its fields first
  snippet?: string;
  // a whole command from your history in this folder, or a fix for the command that just failed
  kind?: "recent" | "fix" | "snippet" | "explain" | "version";
};

export type SuggestionBlob = {
  suggestions: Suggestion[];
  argumentDescription?: string;
  activeToken?: CommandToken;
  isPathContext?: boolean;
  rootCommand?: string;
  // "fix": fixes for the command that failed, shown on an empty line; "explain": what each word of the line does
  mode?: "fix" | "explain" | "fill";
  // shown in the footer of an explain list: warnings about the whole line
  notes?: string[];
};
