// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import chalk from "chalk";
import fs from "node:fs";
import { installResources, withResourcesLock } from "../utils/resources.js";
import { allResourcesPath, preferredResourcesPath } from "../utils/constants.js";

export const render = async () => {
  if (allResourcesPath !== preferredResourcesPath) fs.rmSync(allResourcesPath, { recursive: true, force: true });
  const done = await withResourcesLock(preferredResourcesPath, async () => {
    await installResources(preferredResourcesPath);
    return true;
  });
  if (done == null) throw new Error("another terminalhinter is unpacking its files, try again in a moment");
  process.stdout.write(chalk.green("✓") + " removed old terminalhinter resources \n");
  process.stdout.write(chalk.green("✓") + " successfully installed terminalhinter \n");
};
