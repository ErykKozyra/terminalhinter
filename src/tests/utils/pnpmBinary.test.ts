// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stableBinaryPath } from "../../utils/shell.js";

const unixTest = process.platform === "win32" ? test.skip : test;

// the layout `pnpm add -g` makes: a folder per version in .pnpm, and one link in node_modules to the installed one
const pnpmVersion = (root: string, version: string) => {
  const store = path.join(root, ".pnpm");
  const platformDir = path.join(store, `@erykkozyra+terminalhinter-linux-x64@${version}`, "node_modules", "@erykkozyra", "terminalhinter-linux-x64");
  fs.mkdirSync(platformDir, { recursive: true });
  const binary = path.join(platformDir, "terminalhinter-linux-x64");
  fs.writeFileSync(binary, `#!/bin/sh\necho ${version}\n`, { mode: 0o755 });
  const baseScope = path.join(store, `@erykkozyra+terminalhinter@${version}`, "node_modules", "@erykkozyra");
  fs.mkdirSync(path.join(baseScope, "terminalhinter"), { recursive: true });
  fs.symlinkSync(path.relative(baseScope, platformDir), path.join(baseScope, "terminalhinter-linux-x64"));
  const top = path.join(root, "node_modules", "@erykkozyra");
  fs.mkdirSync(top, { recursive: true });
  fs.rmSync(path.join(top, "terminalhinter"), { force: true });
  fs.symlinkSync(path.relative(top, path.join(baseScope, "terminalhinter")), path.join(top, "terminalhinter"));
  return binary;
};

unixTest("a pnpm install points the startup lines at the link that follows updates", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "thint-pnpm-"));
  const old = pnpmVersion(root, "1.2.0");
  const stable = stableBinaryPath(old);
  expect(stable).not.toBe(old);
  expect(stable).toContain("/node_modules/@erykkozyra/terminalhinter/../terminalhinter-linux-x64/terminalhinter-linux-x64");
  expect(fs.realpathSync.native(stable)).toBe(fs.realpathSync.native(old));
  // pnpm updates: the old version stays on disk, the link moves to the new one, and so does the stable path
  const updated = pnpmVersion(root, "1.2.1");
  expect(fs.existsSync(old)).toBe(true);
  expect(fs.realpathSync.native(stable)).toBe(fs.realpathSync.native(updated));
});

test("other installs keep the binary's own path", () => {
  for (const p of [
    "/usr/local/lib/node_modules/@erykkozyra/terminalhinter/node_modules/@erykkozyra/terminalhinter-linux-x64/terminalhinter-linux-x64",
    "/home/e/.bun/install/global/node_modules/@erykkozyra/terminalhinter-darwin-arm64/terminalhinter-darwin-arm64",
    "/home/e/.local/bin/thint",
    // a pnpm path whose link is missing: nothing better to point at
    "/nowhere/.pnpm/@erykkozyra+terminalhinter-linux-x64@1.2.0/node_modules/@erykkozyra/terminalhinter-linux-x64/terminalhinter-linux-x64",
  ])
    expect(stableBinaryPath(p)).toBe(p);
});
