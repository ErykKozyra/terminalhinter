// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// Layer 8 of the test plan: installing, updating and removing thint the way people do it, against a local npm
// registry (verdaccio) that holds the new version next to the published ones.
//
//   npm run package && npm run package:base
//   QA_VERDACCIO=/path/to/node_modules/.bin/verdaccio npx tsx scripts/qa/install.ts
//
// Settings (environment):
//   QA_VERDACCIO       the verdaccio binary (default: verdaccio on the PATH)
//   QA_PLATFORM_TGZ    the platform package (default: pkg/erykkozyra-terminalhinter-<platform>-<arch>-<version>.tgz)
//   QA_BASE_TGZ        the main package (default: pkg/erykkozyra-terminalhinter-<version>.tgz)
//   QA_FROM            the published version to upgrade from (default: 1.1.3)
//   QA_NEXT_PLATFORM_TGZ, QA_NEXT_BASE_TGZ   the same packages built with a higher version: checks the update
//                      after this one too (the startup lines this version writes must find the next binary)
//   QA_MANAGERS        npm,pnpm,yarn,bun (default: all four that are installed)
//   QA_NODES           extra node binaries for `thint --version` through bin.js, comma separated
//   QA_WORK            work folder (default: a new temporary folder)
//   QA_OUT             JSON report (default: qa-install-report.json)

import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import pty from "node-pty";

const require = createRequire(import.meta.url);
const { Terminal } = require("@xterm/headless") as typeof import("@xterm/headless");

const env = process.env;
const version = JSON.parse(fs.readFileSync("package.json", "utf8")).version as string;
const plat = `${process.platform}-${process.arch}`;
const platformTgz = path.resolve(env.QA_PLATFORM_TGZ ?? `pkg/erykkozyra-terminalhinter-${plat}-${version}.tgz`);
const baseTgz = path.resolve(env.QA_BASE_TGZ ?? `pkg/erykkozyra-terminalhinter-${version}.tgz`);
const from = env.QA_FROM ?? "1.1.3";
// a newer build to update to afterwards (the same code with a higher version), to check the update after this one
const next =
  env.QA_NEXT_PLATFORM_TGZ && env.QA_NEXT_BASE_TGZ
    ? {
        platform: path.resolve(env.QA_NEXT_PLATFORM_TGZ),
        base: path.resolve(env.QA_NEXT_BASE_TGZ),
        version: /-(\d+\.\d+\.\d+)\.tgz$/.exec(env.QA_NEXT_BASE_TGZ)?.[1] ?? "",
      }
    : undefined;
const work = env.QA_WORK ? path.resolve(env.QA_WORK) : fs.mkdtempSync(path.join(os.tmpdir(), "thint-qa-install-"));
const outFile = path.resolve(env.QA_OUT ?? "qa-install-report.json");
const pkgName = "@erykkozyra/terminalhinter";
const port = 4873 + Math.floor(Math.random() * 1000);
const registry = `http://127.0.0.1:${port}`;
const PROMPT = "QAPROMPT> ";
const nodeBin = path.dirname(process.execPath);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const has = (cmd: string) => spawnSync("sh", ["-c", `command -v ${cmd}`]).status === 0;

type Check = { name: string; ok: boolean; detail?: string };
const report: { when: string; platform: string; version: string; from: string; managers: Record<string, Check[]>; other: Record<string, Check[]> } = {
  when: new Date().toISOString(),
  platform: plat,
  version,
  from,
  managers: {},
  other: {},
};

const check = (list: Check[], name: string, ok: boolean, detail?: string) => {
  list.push({ name, ok, detail: detail?.slice(0, 2000) });
  process.stderr.write(`  ${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? `: ${detail.slice(0, 300).replace(/\n/g, " | ")}` : ""}\n`);
};

const run = (cmd: string, args: string[], e: NodeJS.ProcessEnv, cwd = work, timeout = 300_000) => {
  const r = spawnSync(cmd, args, { env: e, cwd, encoding: "utf8", timeout });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}`, error: r.error };
};

// ---------- the local registry ----------

const startRegistry = async () => {
  const dir = path.join(work, "registry");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const proxy = env.HTTPS_PROXY ?? env.https_proxy;
  fs.writeFileSync(
    path.join(dir, "config.yaml"),
    [
      `storage: ${path.join(dir, "storage")}`,
      "auth:",
      `  htpasswd: { file: ${path.join(dir, "htpasswd")}, max_users: 10 }`,
      "uplinks:",
      "  npmjs: { url: https://registry.npmjs.org/, timeout: 60s }",
      proxy ? `https_proxy: ${proxy}` : "",
      "packages:",
      "  '@erykkozyra/*': { access: $all, publish: $all, proxy: npmjs }",
      "  '**': { access: $all, publish: $all, proxy: npmjs }",
      "max_body_size: 300mb",
      "log: { type: stdout, format: pretty, level: warn }",
      "",
    ].join("\n"),
  );
  const bin = env.QA_VERDACCIO ?? "verdaccio";
  const child = spawn(bin, ["--config", path.join(dir, "config.yaml"), "--listen", `127.0.0.1:${port}`], {
    stdio: ["ignore", fs.openSync(path.join(dir, "log.txt"), "a"), fs.openSync(path.join(dir, "log.txt"), "a")],
    env: { ...env },
  });
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${registry}/-/ping`);
      if (r.ok) break;
    } catch {
      // not up yet
    }
    await sleep(300);
  }
  const user = await fetch(`${registry}/-/user/org.couchdb.user:qa`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "qa", password: "qa-password-1", type: "user", roles: [] }),
  });
  const { token } = (await user.json()) as { token: string };
  const npmrc = path.join(work, "publish.npmrc");
  fs.writeFileSync(npmrc, `registry=${registry}/\n//127.0.0.1:${port}/:_authToken=${token}\n`);
  // the release publishes one package per platform; here only this one is real, the others are empty stand-ins with
  // the same os and cpu fields, so managers that resolve every optional package (yarn 1) find them
  const publish = (ver: string, platform: string, base: string) => {
    const stubs: string[] = [];
    for (const other of ["darwin-x64", "darwin-arm64", "linux-x64", "linux-arm64", "win32-x64", "win32-arm64"]) {
      if (other === plat) continue;
      const [os_, cpu] = other.split("-");
      const stubDir = path.join(dir, "stubs", ver, other);
      fs.mkdirSync(stubDir, { recursive: true });
      fs.writeFileSync(
        path.join(stubDir, "package.json"),
        JSON.stringify({ name: `${pkgName}-${other}`, version: ver, os: [os_], cpu: [cpu], description: "stand-in for the test registry" }),
      );
      stubs.push(stubDir);
    }
    for (const tgz of [platform, ...stubs, base]) {
      const r = run("npm", ["publish", tgz, "--userconfig", npmrc, "--registry", `${registry}/`, "--tag", "latest"], { ...env });
      if (r.status !== 0 && !/cannot publish over/i.test(r.out)) throw new Error(`publishing ${tgz} failed:\n${r.out}`);
    }
  };
  publish(version, platformTgz, baseTgz);
  if (next != null) publish(next.version, next.platform, next.base);
  return child;
};

// ---------- a terminal tab ----------

class Tab {
  term = new Terminal({ cols: 120, rows: 30, allowProposedApi: true });
  proc;
  constructor(home: string, e: NodeJS.ProcessEnv) {
    this.proc = pty.spawn("zsh", ["-i"], { name: "xterm-256color", cols: 120, rows: 30, cwd: home, env: e as { [key: string]: string } });
    this.proc.onData((d) => this.term.write(d));
  }
  screen() {
    const b = this.term.buffer.active;
    const lines: string[] = [];
    for (let y = 0; y <= b.length; y++) lines.push(b.getLine(y)?.translateToString(true) ?? "");
    return lines.join("\n").replace(/\n+$/, "");
  }
  async waitFor(text: string | RegExp, timeout = 20_000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (typeof text === "string" ? this.screen().includes(text) : text.test(this.screen())) return true;
      await sleep(50);
    }
    return false;
  }
  async type(text: string, wait = 600) {
    this.proc.write(text);
    await sleep(wait);
  }
  // the thint process behind this tab: its binary, and whether that file is still there
  thint(): { pid: number; exe: string } | undefined {
    const out = spawnSync("ps", ["-A", "-o", "pid=,ppid=,args="], { encoding: "utf8" }).stdout;
    const rows = out
      .split("\n")
      .map((l) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l))
      .filter((m): m is RegExpExecArray => m != null)
      .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), args: m[3] }));
    const queue = [this.proc.pid];
    while (queue.length > 0) {
      const p = queue.shift()!;
      for (const c of rows.filter((r) => r.ppid === p)) {
        if (/\s-s\s+zsh/.test(c.args)) {
          let exe = c.args;
          try {
            exe = fs.readlinkSync(`/proc/${c.pid}/exe`);
          } catch {
            // no /proc on macOS: the command line is the best there is
          }
          return { pid: c.pid, exe };
        }
        queue.push(c.pid);
      }
    }
    return undefined;
  }
  close() {
    try {
      this.proc.kill();
    } catch {
      // gone
    }
  }
}

// ---------- one package manager ----------

type Manager = {
  name: string;
  install: (spec: string) => [string, string[]];
  remove: () => [string, string[]];
  binDir: string;
};

const managerFor = (name: string, root: string, home: string): Manager => {
  const spec = (s: string) => `${pkgName}@${s}`;
  switch (name) {
    case "npm":
      return {
        name,
        binDir: path.join(root, "prefix", "bin"),
        install: (s) => ["npm", ["i", "-g", "--prefix", path.join(root, "prefix"), spec(s)]],
        remove: () => ["npm", ["rm", "-g", "--prefix", path.join(root, "prefix"), pkgName]],
      };
    case "pnpm":
      return {
        name,
        binDir: path.join(root, "pnpm"),
        install: (s) => ["pnpm", ["add", "-g", spec(s)]],
        remove: () => ["pnpm", ["rm", "-g", pkgName]],
      };
    case "yarn":
      return {
        name,
        binDir: path.join(root, "prefix", "bin"),
        install: (s) => ["yarn", ["global", "add", spec(s), "--prefix", path.join(root, "prefix"), "--registry", `${registry}/`]],
        remove: () => ["yarn", ["global", "remove", pkgName, "--prefix", path.join(root, "prefix")]],
      };
    case "bun":
      return {
        name,
        binDir: path.join(home, ".bun", "bin"),
        install: (s) => ["bun", ["add", "-g", spec(s)]],
        remove: () => ["bun", ["rm", "-g", pkgName]],
      };
  }
  throw new Error(`unknown manager ${name}`);
};

// files left in the home and the install folders after uninstalling, without the package managers' own caches
const leftovers = (dirs: string[]): string[] => {
  const found: string[] = [];
  const skip =
    /\/(\.npm|\.cache|\.bun\/install\/cache|\.local\/share\/pnpm\/store|\.yarn-cache|\.yarnrc|\.npmrc|\.zshrc|\.zsh_history|\.config\/yarn\/global\/(package\.json|yarn\.lock)|pnpm\/global\/\d+\/(package\.json|pnpm-lock\.yaml)|\.bun\/install\/global\/(package\.json|bun\.lockb?))/;
  const walk = (d: string) => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (skip.test(p)) continue;
      if (/terminalhinter|thint/i.test(e.name)) found.push(p);
      else if (e.isDirectory() && !e.isSymbolicLink()) walk(p);
    }
  };
  for (const d of dirs) walk(d);
  return found;
};

const scenario = async (name: string) => {
  const checks: Check[] = [];
  report.managers[name] = checks;
  process.stderr.write(`\n${name}\n`);
  const root = path.join(work, name);
  const home = path.join(root, "home");
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(home, { recursive: true });
  const m = managerFor(name, root, home);
  fs.writeFileSync(path.join(home, ".npmrc"), `registry=${registry}/\n`);
  fs.mkdirSync(path.join(home, ".bun"), { recursive: true });
  fs.writeFileSync(path.join(home, ".bunfig.toml"), `[install]\nregistry = "${registry}/"\n`);
  const e: NodeJS.ProcessEnv = {
    HOME: home,
    PATH: [
      m.binDir,
      nodeBin,
      path.dirname(execFileSync("sh", ["-c", "command -v bun || echo /nonexistent/bun"], { encoding: "utf8" }).trim()),
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
    ].join(":"),
    TERM: "xterm-256color",
    LANG: "C.UTF-8",
    npm_config_registry: `${registry}/`,
    npm_config_userconfig: path.join(home, ".npmrc"),
    BUN_CONFIG_REGISTRY: `${registry}/`,
    BUN_INSTALL: path.join(home, ".bun"),
    PNPM_HOME: path.join(root, "pnpm"),
    XDG_DATA_HOME: path.join(home, ".local", "share"),
    XDG_CONFIG_HOME: path.join(home, ".config"),
    THINT_NO_UPDATE_CHECK: "1",
    NODE_EXTRA_CA_CERTS: env.NODE_EXTRA_CA_CERTS,
    SSL_CERT_FILE: env.SSL_CERT_FILE,
  };

  // 1. the published version, as someone has it today
  const [c1, a1] = m.install(from);
  const i1 = run(c1, a1, e, home);
  check(checks, `install ${from}`, i1.status === 0, i1.out);
  const v1 = run("thint", ["--version"], e, home);
  check(checks, `thint --version is ${from}`, v1.out.trim() === from, v1.out);
  const init = run("thint", ["init", "zsh"], e, home);
  check(checks, "thint init zsh prints the startup line", init.status === 0 && /init\.zsh/.test(init.out), init.out);
  fs.writeFileSync(path.join(home, ".zshrc"), `${init.out.trim()}\nexport THINT_NO_UPDATE_CHECK=1\nPROMPT='${PROMPT}'\n`);

  const tabA = new Tab(home, e);
  check(checks, `a tab opens with ${from}`, await tabA.waitFor(PROMPT), tabA.screen());
  await tabA.type("git st", 1500);
  check(checks, `the list shows in the ${from} tab`, /[╭┌]/.test(tabA.screen()), tabA.screen());
  await tabA.type("\x15", 400);

  // 2. the update, the way people do it with that manager, while that tab stays open
  const [c2, a2] = m.install(version);
  const i2 = run(c2, a2, e, home);
  check(checks, `update to ${version} with ${name}`, i2.status === 0, i2.out);
  const v2 = run("thint", ["--version"], e, home);
  check(checks, `thint --version is ${version}`, v2.out.trim() === version, v2.out);

  await tabA.type("echo QA_A_$((1+1))\r", 800);
  check(checks, "the tab opened before the update still runs commands", tabA.screen().includes("QA_A_2"), tabA.screen());
  await tabA.type("git st", 1500);
  check(checks, "and still shows the list", /[╭┌]/.test(tabA.screen()), tabA.screen());
  await tabA.type("\x15", 300);

  // 3. a new tab after the update runs the new version, with no error and no `thint reinit`
  const tabB = new Tab(home, e);
  const promptB = await tabB.waitFor(PROMPT);
  await sleep(800);
  const proc = tabB.thint();
  const unpacked = (() => {
    try {
      return fs.readFileSync(path.join(home, ".local", "share", "terminalhinter", "version.txt"), "utf8").trim();
    } catch {
      return "missing";
    }
  })();
  check(checks, "a new tab after the update opens", promptB, tabB.screen());
  check(
    checks,
    `the new tab runs ${version} (says so, and is not the old file)`,
    proc != null && !/\(deleted\)/.test(proc.exe) && tabB.screen().includes(`is now ${version}`),
    `${proc?.exe ?? "no thint process"}\n${tabB.screen()}`,
  );
  check(checks, `the unpacked files are ${version}`, unpacked === version, unpacked);
  check(checks, "no error or reinit request in the new tab", !/reinit|error|not found|missing/i.test(tabB.screen()), tabB.screen());
  await tabB.type("git st", 1500);
  check(checks, "the list shows in the new tab", /[╭┌]/.test(tabB.screen()), tabB.screen());
  await tabB.type("\x15", 300);
  tabA.close();
  tabB.close();

  // 3b. the update after this one: the startup lines written by this version must lead to the next binary
  if (next != null) {
    const tabD = new Tab(home, e);
    await tabD.waitFor(PROMPT);
    const [c4, a4] = m.install(next.version);
    const i4 = run(c4, a4, e, home);
    check(checks, `update to ${next.version} with ${name}`, i4.status === 0, i4.out);
    await tabD.type("echo QA_D_$((3+1))\r", 800);
    check(checks, "a tab opened before that update still runs commands", tabD.screen().includes("QA_D_4"), tabD.screen());
    tabD.close();
    const tabE = new Tab(home, e);
    await tabE.waitFor(PROMPT);
    await sleep(800);
    check(checks, `the next new tab runs ${next.version} with no thint reinit`, tabE.screen().includes(`is now ${next.version}`), tabE.screen());
    tabE.close();
  }

  // 4. thint update finds the manager and runs it
  const upd = run("thint", ["update", "--force"], e, home);
  check(checks, `thint update --force reinstalls with ${name}`, upd.status === 0 && new RegExp(`with ${name}`).test(upd.out), upd.out);
  const doctor = run("thint", ["doctor"], e, home);
  check(checks, "thint doctor has no failures", doctor.status === 0 && !/✗/.test(doctor.out), doctor.out);

  // 5. removing it leaves a working shell and no files behind
  const un = run("thint", ["uninstall"], e, home);
  check(checks, "thint uninstall", un.status === 0, un.out);
  const [c3, a3] = m.remove();
  const rm = run(c3, a3, e, home);
  check(checks, `${name} removes the package`, rm.status === 0, rm.out);
  const tabC = new Tab(home, e);
  const promptC = await tabC.waitFor(PROMPT, 8_000);
  await tabC.type("echo QA_C_$((2+1))\r", 800);
  check(
    checks,
    "a new tab after uninstalling is a plain working shell",
    promptC && tabC.screen().includes("QA_C_3") && !/not found|no such file/i.test(tabC.screen()),
    tabC.screen(),
  );
  tabC.close();
  const left = leftovers([home, root]);
  check(checks, "no terminalhinter files left behind", left.length === 0, left.join("\n"));
};

// ---------- nvm: two Node versions, thint installed under one ----------

const nvm = async () => {
  const checks: Check[] = [];
  report.other.nvm = checks;
  const versions = (env.QA_NVM_NODES ?? "/opt/node20/bin/node,/opt/node22/bin/node").split(",").filter((n) => fs.existsSync(n));
  if (versions.length < 2) {
    check(checks, "two Node versions available", false, versions.join(", "));
    return;
  }
  process.stderr.write("\nnvm\n");
  const root = path.join(work, "nvm");
  const home = path.join(root, "home");
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(home, { recursive: true });
  // the layout nvm makes: every Node version with its own global npm prefix
  const prefixes = versions.map((node) => {
    const v = execFileSync(node, ["--version"], { encoding: "utf8" }).trim();
    const prefix = path.join(home, ".nvm", "versions", "node", v);
    fs.mkdirSync(path.join(prefix, "bin"), { recursive: true });
    fs.symlinkSync(node, path.join(prefix, "bin", "node"));
    const npmCli = path.join(path.dirname(node), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js");
    fs.writeFileSync(path.join(prefix, "bin", "npm"), `#!/bin/sh\nexec "${node}" "${npmCli}" --prefix "${prefix}" "$@"\n`, { mode: 0o755 });
    return { v, prefix };
  });
  const envFor = (prefix: string): NodeJS.ProcessEnv => ({
    HOME: home,
    PATH: [path.join(prefix, "bin"), "/usr/local/bin", "/usr/bin", "/bin"].join(":"),
    TERM: "xterm-256color",
    LANG: "C.UTF-8",
    npm_config_registry: `${registry}/`,
    THINT_NO_UPDATE_CHECK: "1",
  });
  const [older, newer] = prefixes;
  const eNew = envFor(newer.prefix);
  const i = run("npm", ["i", "-g", `${pkgName}@${version}`], eNew, home);
  check(checks, `install under Node ${newer.v}`, i.status === 0, i.out);
  const init = run("thint", ["init", "zsh"], eNew, home);
  // the guided setup puts the binary's folder on the PATH in the startup block; here we write what it would
  fs.writeFileSync(path.join(home, ".zshrc"), `${init.out.trim()}\nexport THINT_NO_UPDATE_CHECK=1\nPROMPT='${PROMPT}'\n`);
  run("thint", ["reinit"], eNew, home);
  // switch the default Node: the PATH now has the other version, where thint is not installed
  const eOld = envFor(older.prefix);
  const tab = new Tab(home, eOld);
  check(checks, `a new tab with Node ${older.v} on the PATH opens`, await tab.waitFor(PROMPT), tab.screen());
  await sleep(500);
  await tab.type("git st", 1500);
  check(checks, "and still has the list (thint carries its own runtime)", /[╭┌]/.test(tab.screen()), tab.screen());
  tab.close();
  const which = run("sh", ["-c", "command -v thint || echo none"], eOld, home);
  check(checks, `thint the command is not on the PATH of Node ${older.v} (expected, README says so)`, which.out.trim() === "none", which.out);
  const i2 = run("npm", ["i", "-g", `${pkgName}@${version}`], eOld, home);
  const v2 = run("thint", ["--version"], eOld, home);
  check(checks, `npm i -g again under Node ${older.v} brings the command back`, i2.status === 0 && v2.out.trim() === version, i2.out + v2.out);
};

// ---------- bin.js under every Node version available ----------

const nodes = async () => {
  const checks: Check[] = [];
  report.other.nodes = checks;
  const list = (env.QA_NODES ?? "/opt/node20/bin/node,/opt/node21/bin/node,/opt/node22/bin/node").split(",").filter((n) => fs.existsSync(n));
  process.stderr.write("\nnode versions\n");
  const root = path.join(work, "nodes");
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const i = run("npm", ["i", "-g", "--prefix", root, `${pkgName}@${version}`], { ...env, npm_config_registry: `${registry}/` }, root);
  check(checks, "install for the Node version check", i.status === 0, i.out);
  const binJs = path.join(root, "lib", "node_modules", "@erykkozyra", "terminalhinter", "bin.js");
  for (const node of list) {
    const v = execFileSync(node, ["--version"], { encoding: "utf8" }).trim();
    const r = run(node, [binJs, "--version"], { ...env, HOME: root, THINT_NO_UPDATE_CHECK: "1" }, root);
    check(checks, `bin.js under Node ${v}`, r.status === 0 && r.out.trim() === version, r.out);
  }
};

const main = async () => {
  for (const f of [platformTgz, baseTgz]) if (!fs.existsSync(f)) throw new Error(`missing ${f}: run npm run package and npm run package:base first`);
  if (!has("zsh")) throw new Error("zsh is needed for the tab checks");
  const registryProcess = await startRegistry();
  try {
    const managers = (env.QA_MANAGERS ?? "npm,pnpm,yarn,bun").split(",").filter((m) => has(m));
    for (const m of managers) {
      try {
        await scenario(m);
      } catch (e) {
        (report.managers[m] ??= []).push({ name: "scenario finished", ok: false, detail: String(e) });
      }
      fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
    }
    await nvm().catch((e) => (report.other.nvm ??= []).push({ name: "nvm finished", ok: false, detail: String(e) }));
    await nodes().catch((e) => (report.other.nodes ??= []).push({ name: "nodes finished", ok: false, detail: String(e) }));
  } finally {
    registryProcess.kill();
  }
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  const all = [...Object.entries(report.managers), ...Object.entries(report.other)];
  const lines = ["| group | check | result |", "| --- | --- | --- |"];
  for (const [g, list] of all) for (const c of list) lines.push(`| ${g} | ${c.name} | ${c.ok ? "ok" : "FAIL"} |`);
  const failed = all.flatMap(([, l]) => l).filter((c) => !c.ok).length;
  process.stdout.write(lines.join("\n") + `\n\n${failed} failed of ${all.flatMap(([, l]) => l).length}\n`);
  process.exit(failed > 0 ? 1 : 0);
};

main().catch((e) => {
  process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});
