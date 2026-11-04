// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// Unpacking the files terminalhinter needs next to its binary (specs, native modules, shell integration, startup
// scripts). `thint reinit` does it by hand; a new tab does it by itself when the binary was updated.

import fs from "node:fs";
import path from "node:path";

import { unpackResources } from "./node.js";
import { createShellConfigs } from "./shell.js";
import { getResourcePaths } from "./constants.js";

export const removeResources = (resourcesPath: string) => {
  const resources = getResourcePaths(resourcesPath);
  fs.rmSync(resources.shell, { recursive: true, force: true });
  fs.rmSync(resources.native, { recursive: true, force: true });
  fs.rmSync(resources.logging, { recursive: true, force: true });
  fs.rmSync(resources.init, { recursive: true, force: true });
  fs.rmSync(resources.spec, { recursive: true, force: true });
  fs.rmSync(resources.version, { force: true });
  fs.rmSync(path.join(resourcesPath, "bin"), { recursive: true, force: true });
};

export const installResources = async (resourcesPath: string) => {
  removeResources(resourcesPath);
  await createShellConfigs(getResourcePaths(resourcesPath).init);
  await unpackResources(resourcesPath);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Two tabs opened at once after an update would unpack over each other; the first one takes a lock folder and the
// others wait for it. A lock older than a minute is left over from a crash and is taken over.
export const withResourcesLock = async <T>(resourcesPath: string, work: () => Promise<T>, waitMs = 20_000): Promise<T | undefined> => {
  const lock = path.join(resourcesPath, ".unpacking");
  fs.mkdirSync(resourcesPath, { recursive: true });
  const started = Date.now();
  for (;;) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch {
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > 60_000) fs.rmSync(lock, { recursive: true, force: true });
      } catch {
        // gone in the meantime, try again
      }
      if (Date.now() - started > waitMs) return;
      await sleep(100);
    }
  }
  try {
    return await work();
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
};
