// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Shell, supportedShells as shells } from "../utils/shell.js";
import { inferShell, startupFailedExitCode } from "../utils/shell.js";
import { getConfig, loadConfig } from "../utils/config.js";
import { Command } from "commander";
import log from "../utils/log.js";
import { checkUnpackedVersion } from "../utils/node.js";
import { endTiming, startTiming } from "../utils/performance.js";
import { refreshUpdateState, takeStarNotice, takeUpdateNotice, updateChecksDisabled } from "../utils/update.js";
import { renderStarNotice, renderUpdated, renderUpdateNotice } from "../ui/ui-status.js";
import { allResourcesPath } from "../utils/constants.js";
import sea from "node:sea";

// A new binary with the files of the old one: unpack the new files once, here, instead of asking for
// `thint reinit`. Not on Windows, where files of a running terminalhinter cannot be replaced.
const refreshAfterUpdate = async (): Promise<boolean> => {
  if (!sea.isSea() || process.platform === "win32") return false;
  try {
    const { installResources, withResourcesLock } = await import("../utils/resources.js");
    const done = await withResourcesLock(allResourcesPath, async () => {
      if (!(await checkUnpackedVersion())) await installResources(allResourcesPath);
      return true;
    });
    return done === true && (await checkUnpackedVersion());
  } catch (e) {
    log.debug({ msg: "could not unpack after an update", e: (e as Error).message });
    return false;
  }
};

export const supportedShells = shells.join(", ");

type RootCommandOptions = {
  shell: Shell | undefined;
  verbose: boolean | undefined;
  check: boolean | undefined;
  test: boolean | undefined;
  login: boolean | undefined;
};

export const action = (program: Command) => async (options: RootCommandOptions) => {
  const startupTiming = startTiming();
  const inISTerm = process.env.ISTERM === "1";
  if (options.check || inISTerm) {
    const { renderConfirmation } = await import("../ui/ui-status.js");
    process.stdout.write(renderConfirmation(inISTerm));
    endTiming("startup.check", startupTiming);
    process.exit(0);
  }

  // shown inside the new session: whatever is written to stdout before it starts gets cleared away
  let notice = "";
  if (!(await checkUnpackedVersion())) {
    if (!(await refreshAfterUpdate())) {
      const { renderMissingResources } = await import("../ui/ui-status.js");
      process.stdout.write(renderMissingResources());
      endTiming("startup.missingResources", startupTiming);
      process.exit(startupFailedExitCode);
    }
    notice += renderUpdated();
  }

  if (options.verbose) await log.enable();

  const [, inferredShell] = await Promise.all([loadConfig(program), options.shell ? Promise.resolve(options.shell) : inferShell()]);

  // updateCheck = false turns off every note: the update ones and the one asking for a star
  if (!options.test && !updateChecksDisabled(getConfig().updateCheck)) {
    const latest = takeUpdateNotice();
    if (latest != null) notice += renderUpdateNotice(latest);
    // in the background: the answer is for the next tab, this one does not wait for the network
    void refreshUpdateState();
    // one note per tab at most, and only for a person at a terminal
    if (notice === "" && process.stdout.isTTY && takeStarNotice()) notice = renderStarNotice();
  }

  log.overrideConsole();

  const shell = (options.shell ?? inferredShell) as Shell | undefined;
  if (shell == null) {
    program.error(`Unable to identify shell, use the -s/--shell option to provide your shell`, { exitCode: 1 });
  }
  if (!shells.map((s) => s.valueOf()).includes(shell)) {
    program.error(`Unsupported shell: '${shell}', supported shells: ${supportedShells}`, { exitCode: 1 });
  }

  try {
    const [{ initializeRuntime }, { render }] = await Promise.all([import("../runtime/initialize.js"), import("../ui/ui-root.js")]);
    await initializeRuntime(shell);
    endTiming("startup.beforeRender", startupTiming);
    await render(program, shell, options.test ?? false, options.login ?? false, notice);
  } catch (e) {
    // the startup lines start the shell without the list instead of closing the tab
    process.stderr.write(`thint could not start: ${(e as Error).message}\nthe shell starts without the list; thint doctor says what is wrong\n`);
    process.exit(startupFailedExitCode);
  }
};
