// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// Specs terminalhinter ships on top of withfig/autocomplete: ones that waited in its pull requests and never got
// merged. A spec here wins over the withfig one with the same name; your own YAML files win over both.

import claude from "./claude.js";
import mise from "./mise.js";

export const bundledSpecs: [string, Fig.Spec][] = [
  ["claude", claude],
  ["mise", mise],
];
