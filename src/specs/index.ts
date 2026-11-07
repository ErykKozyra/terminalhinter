// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// Specs terminalhinter ships on top of withfig/autocomplete: newer than the ones there (claude) or ones that waited
// in its pull requests and never got merged (mise). A spec here wins over the withfig one with the same name; your own YAML files win over both.

import claude from "./claude.js"; // generated from claude --help
import mise from "./mise.js";

export const bundledSpecs: [string, Fig.Spec][] = [
  ["claude", claude],
  ["mise", mise],
];
