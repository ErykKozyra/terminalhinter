// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import path from "node:path";
import chalk from "chalk";
import { Command } from "commander";

import { compareVersions, detectInstall, fetchLatestVersion, packageName, refreshUpdateState } from "../utils/update.js";
import { getVersion } from "../utils/version.js";

function fail(text: string, hint?: string): never {
  process.stderr.write(chalk.red("✗") + ` ${text}\n`);
  if (hint) process.stderr.write(`  ${chalk.dim("fix:")} ${chalk.cyan(hint)}\n`);
  process.exit(1);
}

const action = async (options: { force?: boolean }) => {
  const current = getVersion();
  const latest = await fetchLatestVersion(10_000);
  if (latest == null) fail("could not reach the npm registry", `npm i -g ${packageName}@latest, then thint reinit`);
  void refreshUpdateState();

  if (compareVersions(latest, current) <= 0 && !options.force) {
    process.stdout.write(chalk.green("✓") + ` terminalhinter ${current} is the latest version\n`);
    return;
  }

  const install = detectInstall();
  if (install.kind === "source") {
    process.stdout.write(`terminalhinter ${latest} is out, you have ${current}.\n`);
    process.stdout.write(`This copy was built from source. In your terminalhinter folder run:\n\n`);
    process.stdout.write(`  ${chalk.cyan("git pull && ./scripts/install-from-source.sh")}\n`);
    return;
  }
  if (install.kind === "unknown") fail("cannot tell how terminalhinter was installed", `npm i -g ${packageName}@latest, then thint reinit`);

  process.stdout.write(`Updating terminalhinter ${current} to ${latest} with ${install.kind}\n\n`);
  // npm of the Node that installed thint, which matters with nvm: its folder goes first on the PATH
  const env = { ...process.env };
  if (install.binFolder != null) env.PATH = install.binFolder + path.delimiter + (env.PATH ?? "");
  const windows = process.platform === "win32";
  // npm and pnpm are .cmd files on Windows, which only start under a shell; there the line goes whole, Node 24 warns
  // about a command and its arguments given apart with a shell
  const run = (command: string, args: string[], options: SpawnSyncOptions) =>
    windows ? spawnSync([command, ...args].join(" "), { ...options, shell: true }) : spawnSync(command, args, options);
  const installed = run(install.command, install.args, { stdio: "inherit", env });
  if (installed.error != null || installed.status !== 0) {
    const denied = installed.status === 243 || /EACCES/.test(String(installed.error ?? ""));
    fail(
      `${install.kind} could not install the update`,
      denied ? `the global folder needs admin rights: sudo ${install.command} ${install.args.join(" ")}` : `${install.command} ${install.args.join(" ")}`,
    );
  }

  // the new thint unpacks its files and links the startup launcher to itself
  const reinit = run("thint", ["reinit"], { stdio: "ignore", env });
  if (reinit.error != null || reinit.status !== 0) fail("the update is installed, but its files are not unpacked yet", "thint reinit");

  const version = run("thint", ["--version"], { env, encoding: "utf8" }).stdout?.toString().trim();
  process.stdout.write("\n" + chalk.green("✓") + ` terminalhinter ${version || latest} is installed. New terminal tabs use it.\n`);
};

const cmd = new Command("update");
cmd.description(`installs the newest terminalhinter`);
cmd.option("-f, --force", "install again even when this is the newest version");
cmd.action(action);

export default cmd;
