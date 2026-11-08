// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.
/* eslint-disable @typescript-eslint/no-var-requires */

// The specs and shell files are unpacked into the home folder once, before the test files start in parallel. Each
// file unpacking them for itself rewrote files another one was reading at that moment.
const { execFileSync } = require("node:child_process");
const path = require("node:path");

module.exports = () => {
  const tsx = path.join(__dirname, "..", "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
  execFileSync(tsx, ["--eval", "import('./src/utils/node.ts').then((m) => m.unpackResources())"], {
    cwd: path.join(__dirname, ".."),
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  process.env.THINT_RESOURCES_UNPACKED = "1";
};
