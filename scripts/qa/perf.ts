// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// Layer 7 of the test plan: how fast thint feels, measured through a real pty the way a person uses it.
//
//   THINT_BIN=pkg/terminalhinter-linux-x64 npx tsx scripts/qa/perf.ts
//
// Settings (environment):
//   THINT_BIN          the thint binary to test (default: pkg/terminalhinter-<platform>-<arch>)
//   QA_SHELLS          shells to test, comma separated (default: zsh,bash)
//   QA_TAB_RUNS        new tabs per shell, with and without thint (default: 20)
//   QA_KEYS            keystrokes per shell for the latency run (default: 500)
//   QA_SOAK_MINUTES    minutes of fast typing for the memory run, 0 to skip (default: 0)
//   QA_SOAK_RATE       keystrokes per second during the soak (default: 20)
//   QA_OUT             where to write the JSON report (default: qa-perf-report.json)
//   QA_HOME            folder for the fake home (default: a new temporary folder)
//   QA_PARTS           which measurements, comma separated (default: tabs,keys,blocked,soak)
//
// Every section records os.loadavg() next to its numbers: on a busy machine the latency is the machine's, not
// thint's, so read those numbers together.

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import pty from "node-pty";

const require = createRequire(import.meta.url);
const { Terminal } = require("@xterm/headless") as typeof import("@xterm/headless");

type Stats = { n: number; p50: number; p95: number; p99: number; max: number; mean: number };

const env = process.env;
const bin = path.resolve(env.THINT_BIN ?? `pkg/terminalhinter-${process.platform === "darwin" ? "macos" : process.platform}-${process.arch}`);
const shells = (env.QA_SHELLS ?? "zsh,bash").split(",").filter(Boolean);
const tabRuns = Number(env.QA_TAB_RUNS ?? 20);
const keyCount = Number(env.QA_KEYS ?? 500);
const soakMinutes = Number(env.QA_SOAK_MINUTES ?? 0);
const soakRate = Number(env.QA_SOAK_RATE ?? 20);
const outFile = path.resolve(env.QA_OUT ?? "qa-perf-report.json");
const parts = new Set((env.QA_PARTS ?? "tabs,keys,blocked,soak").split(","));
const PROMPT = "QAPROMPT> ";

const budget = { p50: 15, p99: 50, tabExtra: 150, memoryGrowth: 0.2 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const load = () => Number(os.loadavg()[0].toFixed(2));

const stats = (values: number[]): Stats => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => Number((sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1))] ?? 0).toFixed(1));
  const mean = sorted.reduce((a, b) => a + b, 0) / Math.max(1, sorted.length);
  return { n: sorted.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: at(1), mean: Number(mean.toFixed(1)) };
};

const which = (name: string): string => {
  const found = spawnSync("sh", ["-c", `command -v ${name}`], { encoding: "utf8" }).stdout.trim();
  if (!found) throw new Error(`${name} is not installed`);
  return found;
};

const sh = (cmd: string, cwd: string) => execFileSync("sh", ["-c", cmd], { cwd, stdio: "pipe", maxBuffer: 64 * 1024 * 1024 });

// ---------- the fake home ----------

const home = env.QA_HOME ? path.resolve(env.QA_HOME) : fs.mkdtempSync(path.join(os.tmpdir(), "thint-qa-perf-"));
const plainHome = path.join(home, "plain"); // the same shell without thint
const thintHome = path.join(home, "thint");
const repo = path.join(thintHome, "big");

const rcBody = (shell: string) =>
  [
    "export THINT_NO_UPDATE_CHECK=1",
    // versions lookups go to an address that never answers: they must time out quietly and never block typing
    "export npm_config_registry=http://10.255.255.1/",
    shell === "zsh" ? `PROMPT='${PROMPT}'` : `PS1='${PROMPT}'`,
    "unset RPROMPT",
    "",
  ].join("\n");

const startupLines = (shell: string, h: string): string => {
  const out = execFileSync(bin, ["init", shell], { env: { ...baseEnv(h) }, encoding: "utf8" });
  return out.trim() + "\n";
};

const baseEnv = (h: string): { [key: string]: string } => ({
  PATH: [path.dirname(bin), path.dirname(process.execPath), "/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(":"),
  HOME: h,
  TERM: "xterm-256color",
  LANG: "C.UTF-8",
  COLORTERM: "truecolor",
  ...(env.TMPDIR ? { TMPDIR: env.TMPDIR } : {}),
});

const makeBigRepo = () => {
  if (fs.existsSync(path.join(repo, ".git"))) return;
  fs.mkdirSync(repo, { recursive: true });
  const t0 = performance.now();
  for (let d = 0; d < 50; d++) {
    const dir = path.join(repo, "src", `module${d}`);
    fs.mkdirSync(dir, { recursive: true });
    for (let f = 0; f < 100; f++) fs.writeFileSync(path.join(dir, `file${f}.ts`), `export const v${f} = ${d * 100 + f};\n`);
  }
  fs.writeFileSync(
    path.join(repo, "package.json"),
    JSON.stringify({ name: "big", scripts: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`task${i}`, `echo ${i}`])) }, null, 2),
  );
  fs.writeFileSync(path.join(repo, "Makefile"), Array.from({ length: 60 }, (_, i) => `target${i}: ## does thing ${i}\n\techo ${i}\n`).join("\n"));
  fs.writeFileSync(path.join(repo, "compose.yaml"), "services:\n" + Array.from({ length: 20 }, (_, i) => `  service${i}:\n    image: busybox\n`).join(""));
  const git = "git -c user.name=qa -c user.email=qa@example.com -c commit.gpgsign=false";
  sh(`git init -q -b main . && ${git} add -A && ${git} commit -qm init`, repo);
  const head = sh("git rev-parse HEAD", repo).toString().trim();
  const refs = [
    ...Array.from({ length: 300 }, (_, i) => `create refs/heads/feature/branch-${i} ${head}`),
    ...Array.from({ length: 200 }, (_, i) => `create refs/tags/v0.${i}.0 ${head}`),
  ].join("\n");
  execFileSync("git", ["update-ref", "--stdin"], { cwd: repo, input: refs + "\n" });
  for (let i = 0; i < 50; i++) {
    fs.appendFileSync(path.join(repo, "src", "module0", "file0.ts"), `// stash ${i}\n`);
    sh(`${git} stash push -q -m "work in progress ${i}"`, repo);
  }
  process.stderr.write(`big repo ready in ${Math.round(performance.now() - t0)} ms\n`);
};

const writeSpecs = (h: string) => {
  const dir = path.join(h, ".config", "terminalhinter", "specs");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "slowcmd.yaml"), 'name: slowcmd\nargs: { name: thing, script: "sleep 3; echo alpha; echo beta" }\n');
  fs.writeFileSync(path.join(dir, "hangcmd.yaml"), 'name: hangcmd\nargs: { name: thing, script: "sleep 100000" }\n');
};

const prepareHomes = (shell: string) => {
  for (const h of [plainHome, thintHome]) fs.mkdirSync(h, { recursive: true });
  const rc = shell === "zsh" ? ".zshrc" : ".bashrc";
  fs.writeFileSync(path.join(plainHome, rc), rcBody(shell));
  fs.writeFileSync(path.join(thintHome, rc), startupLines(shell, thintHome) + rcBody(shell));
  if (shell === "bash") {
    for (const h of [plainHome, thintHome]) fs.writeFileSync(path.join(h, ".bash_profile"), "[ -f ~/.bashrc ] && . ~/.bashrc\n");
  }
  writeSpecs(thintHome);
  // unpacks the shell files and launchers into the fake home
  execFileSync(bin, ["reinit"], { env: baseEnv(thintHome), stdio: "ignore" });
};

// ---------- one terminal ----------

class Session {
  readonly term;
  readonly proc;
  chunks: number[] = [];
  lastData = 0;
  exited = false;

  constructor(shellPath: string, h: string, cwd: string, rows = 24, cols = 100, extraEnv: { [key: string]: string } = {}) {
    this.term = new Terminal({ cols, rows, allowProposedApi: true });
    this.proc = pty.spawn(shellPath, ["-i"], { name: "xterm-256color", cols, rows, cwd, env: { ...baseEnv(h), ...extraEnv } });
    this.proc.onData((d) => {
      this.lastData = performance.now();
      this.chunks.push(this.lastData);
      this.term.write(d);
    });
    this.proc.onExit(() => (this.exited = true));
  }

  screen(): string {
    const b = this.term.buffer.active;
    const lines: string[] = [];
    for (let y = 0; y < this.term.rows; y++) lines.push(b.getLine(b.viewportY + y)?.translateToString(true) ?? "");
    return lines.join("\n");
  }

  cursorLine(): string {
    const b = this.term.buffer.active;
    return b.getLine(b.baseY + b.cursorY)?.translateToString(true) ?? "";
  }

  async waitFor(test: () => boolean, timeout = 15_000, every = 2): Promise<number | undefined> {
    const start = performance.now();
    while (performance.now() - start < timeout) {
      if (test()) return performance.now();
      await sleep(every);
    }
    return undefined;
  }

  // waits until nothing has been drawn for `quiet` ms; returns the time of the last chunk
  async settle(quiet = 200, timeout = 5_000): Promise<number> {
    const start = performance.now();
    await sleep(quiet);
    while (performance.now() - this.lastData < quiet && performance.now() - start < timeout) await sleep(10);
    return this.lastData;
  }

  // the pid of the thint process running this tab (a child of the shell the pty started), if any
  thintPid(): number | undefined {
    // the launcher is a hard link named like the shell, so look at the whole command line, not the name
    const out = spawnSync("ps", ["-A", "-o", "pid=,ppid=,args="], { encoding: "utf8" }).stdout;
    const rows = out
      .trim()
      .split("\n")
      .map((l) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l))
      .filter((m): m is RegExpExecArray => m != null)
      .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), args: m[3] }));
    const queue = [this.proc.pid];
    while (queue.length > 0) {
      const p = queue.shift()!;
      for (const child of rows.filter((r) => r.ppid === p)) {
        if (/terminalhinter\/bin\/|thint\b/.test(child.args)) return child.pid;
        queue.push(child.pid);
      }
    }
    return undefined;
  }

  // ends the tab with `exit`, so thint shuts down normally and writes its own timings
  async exit() {
    this.proc.write("\x15");
    await sleep(100);
    this.proc.write("exit\r");
    await this.waitFor(() => this.exited, 5_000);
    this.close();
  }

  close() {
    try {
      this.proc.kill();
    } catch {
      // already gone
    }
  }
}

const rssMb = (pid: number): number | undefined => {
  const out = spawnSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" }).stdout.trim();
  return out ? Number((Number(out) / 1024).toFixed(1)) : undefined;
};

// Ctrl+U clears the line (and closes the list). Esc only when a list is still open: with no list it goes to the
// shell, and zsh and bash read Esc plus the next key within their key timeout as one Alt chord.
const listOpen = (s: Session) => /[╭┌]/.test(s.screen());
const clearLine = async (s: Session) => {
  s.proc.write("\x15");
  await s.settle(80, 2_000);
  if (listOpen(s)) {
    s.proc.write("\x1b");
    await sleep(600);
  }
};

// ---------- the measurements ----------

const tabStart = async (shellPath: string, h: string) => {
  const promptTimes: number[] = [];
  const readyTimes: number[] = [];
  let typeaheadOk = 0;
  for (let i = 0; i < tabRuns; i++) {
    const t0 = performance.now();
    const s = new Session(shellPath, h, h);
    // the first run also checks that a command typed before the tab is ready runs once and is not lost
    if (i === 0) s.proc.write("echo QA_TYPEAHEAD_$((40+2))\r");
    const promptAt = await s.waitFor(() => s.screen().includes(PROMPT), 20_000);
    if (promptAt == null) {
      s.close();
      throw new Error(`no prompt in ${h} with ${shellPath}:\n${s.screen()}`);
    }
    if (i === 0) {
      await s.waitFor(() => s.screen().includes("QA_TYPEAHEAD_42"), 5_000);
      await s.settle(300);
      typeaheadOk = (s.screen().match(/QA_TYPEAHEAD_42/g) ?? []).length;
    }
    promptTimes.push(promptAt - t0);
    s.proc.write(`echo QA_READY_$((${i}+1000))\r`);
    const readyAt = await s.waitFor(() => s.screen().includes(`QA_READY_${i + 1000}`), 10_000);
    readyTimes.push((readyAt ?? performance.now()) - t0);
    s.close();
    await sleep(100);
  }
  return { prompt: stats(promptTimes), ready: stats(readyTimes), typeaheadRuns: typeaheadOk };
};

const typingLines = [
  "git ch",
  "git checkout feat",
  "cd sr",
  "npm run ta",
  "docker compose up ser",
  "kill ",
  "make tar",
  "git stash apply ",
  "ls -l",
  "git log --on",
];

type KeyResult = { echo: number[]; settle: number[]; listShown: number; lines: number; keys: number; slowest: { typed: string; ms: number; load: number }[] };

const typeLines = async (s: Session, lines: string[], keys: number, prefix = ""): Promise<KeyResult> => {
  const result: KeyResult = { echo: [], settle: [], listShown: 0, lines: 0, keys: 0, slowest: [] };
  let li = 0;
  while (result.keys < keys) {
    const line = lines[li++ % lines.length];
    let typed = prefix;
    for (const ch of line) {
      typed += ch;
      const t0 = performance.now();
      s.proc.write(ch);
      const echoAt = await s.waitFor(() => s.cursorLine().includes(PROMPT + typed) || s.screen().includes(PROMPT + typed), 3_000, 1);
      result.echo.push((echoAt ?? performance.now()) - t0);
      const last = await s.settle(150, 4_000);
      result.settle.push(Math.max(0, last - t0));
      result.slowest.push({ typed, ms: Number(Math.max(0, last - t0).toFixed(1)), load: load() });
      result.slowest = result.slowest.sort((a, b) => b.ms - a.ms).slice(0, 10);
      result.keys++;
    }
    if (listOpen(s)) result.listShown++;
    result.lines++;
    if (prefix) break;
    await clearLine(s);
  }
  return result;
};

// thint's own timings (ISTERM_PERF): what it spends working, apart from what the machine spends elsewhere
const internalTimings = (file: string) => {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as {
      metrics: Record<string, { count: number; averageMilliseconds: number; maxMilliseconds: number }>;
    };
    return Object.fromEntries(
      Object.entries(data.metrics)
        .sort((a, b) => b[1].averageMilliseconds * b[1].count - a[1].averageMilliseconds * a[1].count)
        .slice(0, 12)
        .map(([k, v]) => [k, { count: v.count, avg: Number(v.averageMilliseconds.toFixed(2)), max: Number(v.maxMilliseconds.toFixed(1)) }]),
    );
  } catch {
    return undefined;
  }
};

const keyLatency = async (shellPath: string) => {
  const perfFile = path.join(home, `thint-timings-${path.basename(shellPath)}.json`);
  fs.rmSync(perfFile, { force: true });
  const s = new Session(shellPath, thintHome, repo, 24, 100, { ISTERM_PERF: "1", ISTERM_PERF_OUTPUT: perfFile });
  await s.waitFor(() => s.screen().includes(PROMPT), 20_000);
  await s.settle(500);
  const warm = await typeLines(s, typingLines, 30); // fills caches and loads the specs once
  void warm;
  const loadBefore = load();
  const r = await typeLines(s, typingLines, keyCount);
  const out = {
    loadavg: [loadBefore, load()],
    keys: r.keys,
    lines: r.lines,
    linesWithList: r.listShown,
    echo: stats(r.echo),
    settle: stats(r.settle),
    slowest: r.slowest,
    thintTimings: undefined as unknown,
  };
  await s.exit();
  out.thintTimings = internalTimings(perfFile);
  return out;
};

// typing while a generator is slow, hangs, or waits on the network must stay as fast as anywhere else
const blockedGenerators = async (shellPath: string) => {
  const s = new Session(shellPath, thintHome, repo);
  await s.waitFor(() => s.screen().includes(PROMPT), 20_000);
  await s.settle(500);
  const cases: Record<string, unknown> = {};
  for (const [name, prefix] of [
    ["slow generator (sleep 3)", "slowcmd "],
    ["hanging generator", "hangcmd "],
    ["versions with no network", "npm i react@"],
  ] as const) {
    for (const ch of prefix) {
      s.proc.write(ch);
      await sleep(15);
    }
    const r = await typeLines(s, ["abcdefgh"], 8, prefix).catch(() => undefined);
    // the line is still alive: what was typed is on the screen
    const alive = s.screen().includes(PROMPT);
    cases[name] = { loadavg: load(), echo: r ? stats(r.echo) : undefined, alive };
    await clearLine(s);
    await s.settle(200);
  }
  // after a slow generator finishes, its values show up without typing anything more
  s.proc.write("slowcmd ");
  const appeared = await s.waitFor(() => s.screen().includes("alpha"), 8_000);
  cases["slow generator values arrive"] = appeared != null;
  await clearLine(s);
  s.close();
  return cases;
};

const soak = async (shellPath: string) => {
  if (soakMinutes <= 0) return undefined;
  const s = new Session(shellPath, thintHome, repo);
  await s.waitFor(() => s.screen().includes(PROMPT), 20_000);
  await s.settle(500);
  const pid = s.thintPid();
  if (pid == null) throw new Error("could not find the thint process");
  const samples: { minute: number; rssMb?: number; loadavg: number; keys: number }[] = [];
  const started = performance.now();
  let keys = 0;
  let nextSample = 0;
  const delay = 1000 / soakRate;
  let li = 0;
  while (performance.now() - started < soakMinutes * 60_000) {
    const minute = (performance.now() - started) / 60_000;
    if (minute >= nextSample) {
      samples.push({ minute: Number(minute.toFixed(1)), rssMb: rssMb(pid), loadavg: load(), keys });
      nextSample += soakMinutes >= 30 ? 5 : 1;
    }
    const line = typingLines[li++ % typingLines.length];
    for (const ch of line) {
      s.proc.write(ch);
      keys++;
      await sleep(delay);
    }
    await clearLine(s);
    await sleep(delay * 2);
    if (s.exited) throw new Error("the tab closed during the soak");
  }
  await s.settle(500);
  samples.push({ minute: soakMinutes, rssMb: rssMb(pid), loadavg: load(), keys });
  // the shell still works after all that
  s.proc.write("echo QA_SOAK_OK\r");
  const ok = (await s.waitFor(() => s.screen().includes("QA_SOAK_OK"), 5_000)) != null;
  s.close();
  const rss = samples.map((x) => x.rssMb ?? 0);
  const firstStable = samples.find((x) => x.minute >= Math.min(10, soakMinutes / 3))?.rssMb ?? rss[0];
  const last = rss[rss.length - 1];
  return {
    minutes: soakMinutes,
    keys,
    shellAlive: ok,
    rssStartMb: rss[0],
    rssAfterWarmupMb: firstStable,
    rssEndMb: last,
    growthAfterWarmup: Number(((last - firstStable) / firstStable).toFixed(3)),
    slopeMbPerHour: Number((((last - firstStable) / Math.max(1, soakMinutes - Math.min(10, soakMinutes / 3))) * 60).toFixed(1)),
    samples,
  };
};

// ---------- main ----------

const main = async () => {
  if (!fs.existsSync(bin)) throw new Error(`no thint binary at ${bin}: build one with npm run package or set THINT_BIN`);
  const report: Record<string, unknown> = {
    when: new Date().toISOString(),
    platform: `${process.platform}-${process.arch}`,
    cpus: os.cpus().length,
    bin,
    version: execFileSync(bin, ["--version"], { encoding: "utf8" }).trim(),
    budget,
    shells: {} as Record<string, unknown>,
  };
  process.stderr.write("preparing the big repo\n");
  fs.mkdirSync(thintHome, { recursive: true });
  makeBigRepo();
  for (const shell of shells) {
    const shellPath = which(shell);
    prepareHomes(shell);
    const r: Record<string, unknown> = { path: shellPath };
    (report.shells as Record<string, unknown>)[shell] = r;
    if (parts.has("tabs")) {
      process.stderr.write(`${shell}: new tabs\n`);
      const plain = await tabStart(shellPath, plainHome);
      const withThint = await tabStart(shellPath, thintHome);
      r.tabStart = {
        loadavg: load(),
        plain,
        thint: withThint,
        extraPromptMedian: Number((withThint.prompt.p50 - plain.prompt.p50).toFixed(1)),
        extraPromptP95: Number((withThint.prompt.p95 - plain.prompt.p95).toFixed(1)),
        extraReadyMedian: Number((withThint.ready.p50 - plain.ready.p50).toFixed(1)),
      };
    }
    if (parts.has("keys")) {
      process.stderr.write(`${shell}: keystrokes\n`);
      r.keys = await keyLatency(shellPath);
    }
    if (parts.has("blocked")) {
      process.stderr.write(`${shell}: slow, hanging and offline generators\n`);
      r.blocked = await blockedGenerators(shellPath);
    }
    if (parts.has("soak") && shell === shells[0]) {
      process.stderr.write(`${shell}: soak for ${soakMinutes} minutes\n`);
      r.soak = await soak(shellPath);
    }
    fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  }
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  process.stdout.write(summary(report) + "\n");
};

const mark = (ok: boolean) => (ok ? "ok" : "OVER");

const summary = (report: Record<string, unknown>): string => {
  const lines = [
    `thint ${report.version} on ${report.platform}, ${report.cpus} CPUs`,
    "",
    "| shell | measure | value | budget | load |",
    "| --- | --- | --- | --- | --- |",
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const [shell, r] of Object.entries(report.shells as Record<string, any>)) {
    const t = r.tabStart;
    if (t)
      lines.push(
        `| ${shell} | tab start, extra median / p95 | ${t.extraPromptMedian} / ${t.extraPromptP95} ms | ${budget.tabExtra} ms ${mark(
          t.extraPromptMedian <= budget.tabExtra,
        )} | ${t.loadavg} |`,
      );
    if (t) lines.push(`| ${shell} | typed before ready, runs | ${t.thint.typeaheadRuns} time(s) | 1 ${mark(t.thint.typeaheadRuns === 1)} | |`);
    const k = r.keys;
    if (k) lines.push(`| ${shell} | key to echo p50 / p99 | ${k.echo.p50} / ${k.echo.p99} ms | | ${k.loadavg.join(" to ")} |`);
    if (k)
      lines.push(
        `| ${shell} | key to list drawn p50 / p99 | ${k.settle.p50} / ${k.settle.p99} ms | ${budget.p50} / ${budget.p99} ms ${mark(
          k.settle.p50 <= budget.p50 && k.settle.p99 <= budget.p99,
        )} | |`,
      );
    for (const [name, c] of Object.entries((r.blocked ?? {}) as Record<string, { echo?: Stats; alive?: boolean } | boolean>)) {
      if (typeof c === "boolean") lines.push(`| ${shell} | ${name} | ${c ? "yes" : "no"} | yes ${mark(c)} | |`);
      else
        lines.push(
          `| ${shell} | ${name}: echo p50 / p99 | ${c.echo?.p50} / ${c.echo?.p99} ms | ${budget.p99} ms ${mark((c.echo?.p99 ?? 1e9) <= budget.p99)} | |`,
        );
    }
    if (r.soak) {
      const s = r.soak;
      lines.push(
        `| ${shell} | soak ${s.minutes} min, ${s.keys} keys: RSS start / warm / end | ${s.rssStartMb} / ${s.rssAfterWarmupMb} / ${s.rssEndMb} MB (${(
          s.growthAfterWarmup * 100
        ).toFixed(1)}%, ${s.slopeMbPerHour} MB/h) | ${budget.memoryGrowth * 100}% ${mark(s.growthAfterWarmup <= budget.memoryGrowth && s.shellAlive)} | |`,
      );
    }
  }
  return lines.join("\n");
};

main().catch((e) => {
  process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});
