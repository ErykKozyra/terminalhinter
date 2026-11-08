// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// Live scenarios: every scenario in ./scenarios runs in a real shell inside thint, through a real pty, in each
// shell and terminal size it allows. A run checks what is on the screen, which commands the shell actually ran,
// and that the shell still answers at the end.
//
//   node scripts/qa/live/run.mjs [--bin "node build/index.js"] [--shells zsh,bash] [--sizes 80x24,40x10]
//        [--only name-part] [--jobs 2] [--out results.json] [--keep]

import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const require = createRequire(path.join(repo, "package.json"));
const pty = require("node-pty");
const { Terminal } = require("@xterm/headless");
const YAML = require("yaml");

const isWin = process.platform === "win32";
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const defaultShells = isWin ? ["pwsh", "powershell", "cmd", "bash"] : ["zsh", "bash", "fish", "pwsh"];
const which = (bin) => {
  try {
    return execFileSync(isWin ? "where" : "which", [bin], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split(/\r?\n/)[0].trim();
  } catch {
    return "";
  }
};
const shells = (opt("shells") ?? defaultShells.join(",")).split(",").filter(Boolean);
const sizes = (opt("sizes") ?? "80x24,40x10,200x60").split(",").map((s) => s.split("x").map(Number));
const only = opt("only");
const jobs = Number(opt("jobs", String(Math.max(1, Math.min(4, os.cpus().length - 1)))));
const out = opt("out");
const keep = flag("keep");
// --bin is a path to a thint binary, or a JSON array of a program and its arguments
const binSpec = opt("bin", process.env.THINT_BIN);
const [binCmd, ...binArgs] = binSpec == null ? [process.execPath, path.join(repo, "build", "index.js")] : binSpec.startsWith("[") ? JSON.parse(binSpec) : [binSpec];
// where PowerShell reads its profile on Windows (on Linux and macOS it is under the HOME we set)
const windowsProfiles = {};
const windowsProfile = (shell) => {
  if (!isWin) return null;
  if (!(shell in windowsProfiles))
    windowsProfiles[shell] = execFileSync(shell === "powershell" ? "powershell.exe" : "pwsh.exe", ["-NoProfile", "-Command", "$PROFILE.CurrentUserCurrentHost"], {
      encoding: "utf8",
    }).trim();
  return windowsProfiles[shell];
};
const slow = Number(process.env.QA_SLOW ?? "1"); // multiply every wait on slow machines

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const keyNames = {
  TAB: "\t",
  "S-TAB": "\x1b[Z",
  CR: "\r",
  ENTER: "\r",
  ESC: "\x1b",
  BS: "\x7f",
  UP: "\x1b[A",
  DOWN: "\x1b[B",
  RIGHT: "\x1b[C",
  LEFT: "\x1b[D",
  "S-UP": "\x1b[1;2A",
  "S-DOWN": "\x1b[1;2B",
  HOME: "\x1b[H",
  END: "\x1b[F",
  "C-SPC": "\x00",
  "C-G": "\x07",
  "C-C": "\x03",
  "C-U": "\x15",
  "C-A": "\x01",
  "C-E": "\x05",
  "C-W": "\x17",
  "C-L": "\x0c",
  "C-R": "\x12",
  "C-D": "\x04",
};
// "git ch<TAB>" → chunks to send one by one: plain characters one at a time, named keys as a whole
const toChunks = (text) => {
  const chunks = [];
  const re = /<([A-Z-]+)>/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (!(m[1] in keyNames)) continue;
    for (const ch of text.slice(last, m.index)) chunks.push(ch);
    chunks.push(keyNames[m[1]]);
    last = m.index + m[0].length;
  }
  for (const ch of text.slice(last)) chunks.push(ch);
  return chunks;
};

const prompt = "qa$ ";
const listChars = /[╭╮╰╯┌┐└┘]/;

const rcFor = (shell, home) => {
  const log = path.join(home, "ran.log");
  switch (shell) {
    case "zsh":
      return [[".zshrc", `PROMPT='${prompt}'\nHISTFILE=~/.zsh_history\nSAVEHIST=1000\nHISTSIZE=1000\npreexec() { print -r -- "$1" >> ${JSON.stringify(log)} }\n`]];
    case "bash":
      return [
        [
          ".bashrc",
          `PS1='${prompt}'\nHISTFILE=~/.bash_history\n__qa_log() { printf '%s\\n' "$1" >> ${JSON.stringify(log)}; }\npreexec_functions+=(__qa_log)\n`,
        ],
      ];
    case "fish":
      return [
        [
          ".config/fish/config.fish",
          `set -g fish_autosuggestion_enabled 0\nfunction fish_prompt; printf '${prompt}'; end\nfunction fish_greeting; end\nfunction __qa_log --on-event fish_preexec; printf '%s\\n' "$argv" >> ${JSON.stringify(log)}; end\n`,
        ],
      ];
    case "pwsh":
    case "powershell": {
      const body = `function prompt { '${prompt}' }\nSet-PSReadLineOption -AddToHistoryHandler { param($l) if ($env:QA_LOG) { Add-Content -LiteralPath $env:QA_LOG -Value $l }; return $true }\n`;
      if (!isWin) return [[".config/powershell/Microsoft.PowerShell_profile.ps1", body]];
      // the profile where PowerShell looks for it, and the same place under the home we give it as USERPROFILE
      const real = windowsProfile(shell);
      const user = process.env.USERPROFILE ?? "";
      return [
        [real, body],
        [user && real.startsWith(user) ? path.join(home, real.slice(user.length)) : null, body],
      ];
    }
    default:
      return [];
  }
};

// the project every scenario starts in: a git repo with branches, a package.json, a Makefile and compose file
// everything a run writes lives in one folder of its own
const base = fs.mkdtempSync(path.join(process.env.QA_TMP ?? os.tmpdir(), "thint-qa-"));
const fixtureTemplate = path.join(base, "fixture");
const git = (cwd, ...a) => execFileSync("git", a, { cwd, stdio: "ignore", env: { ...process.env, GIT_AUTHOR_NAME: "qa", GIT_AUTHOR_EMAIL: "qa@example.com", GIT_COMMITTER_NAME: "qa", GIT_COMMITTER_EMAIL: "qa@example.com" } });
const makeFixture = () => {
  const proj = path.join(fixtureTemplate, "shop");
  fs.mkdirSync(path.join(proj, "src", "components"), { recursive: true });
  fs.mkdirSync(path.join(proj, "docs"), { recursive: true });
  fs.mkdirSync(path.join(proj, "folder with space"), { recursive: true });
  fs.mkdirSync(path.join(proj, "zażółć"), { recursive: true });
  fs.writeFileSync(path.join(proj, "README.md"), "# shop\n");
  fs.writeFileSync(path.join(proj, "src", "index.ts"), "export {};\n");
  fs.writeFileSync(
    path.join(proj, "package.json"),
    JSON.stringify({ name: "shop", version: "1.0.0", scripts: { dev: "echo dev", build: "echo build", test: "echo test", "deploy:prod": "echo deploy" } }, null, 2),
  );
  fs.writeFileSync(
    path.join(proj, "Makefile"),
    ".PHONY: build test deploy\n\n##@ Work\nbuild: ## Build everything\n\techo build\n\ntest: ## Run the tests\n\techo test\n\n##@ Release\ndeploy: ## [prod] Ship it\n\techo deploy\n",
  );
  fs.writeFileSync(path.join(proj, "compose.yaml"), "services:\n  web:\n    image: nginx\n  db:\n    image: postgres\n");
  git(proj, "init", "-q", "-b", "main");
  git(proj, "add", ".");
  git(proj, "commit", "-q", "-m", "first commit");
  for (const b of ["feature/login", "fix/cart-total", "release/1.2"]) git(proj, "branch", b);
  fs.writeFileSync(path.join(proj, "src", "index.ts"), "export const x = 1;\n");
  git(proj, "stash", "push", "-q", "-m", "half done cart");
  return proj;
};

const resolveShell = (shell) => {
  if (shell === "cmd") return isWin ? "cmd.exe" : "";
  if (shell === "powershell") return isWin ? which("powershell") : "";
  return which(shell);
};

// thint unpacks its shell files into the home folder once; every run copies this home instead of unpacking again
const homeTemplate = path.join(base, "home-template");
// `thint` typed inside a scenario is the one under test, not whatever is installed on this machine
const shimDir = path.join(base, "bin");
const makeShim = () => {
  fs.mkdirSync(shimDir, { recursive: true });
  if (isWin) fs.writeFileSync(path.join(shimDir, "thint.cmd"), `@"${binCmd}" ${binArgs.map((a) => `"${a}"`).join(" ")} %*\r\n`);
  else {
    fs.writeFileSync(path.join(shimDir, "thint"), `#!/bin/sh\nexec ${[binCmd, ...binArgs].map((a) => `'${a}'`).join(" ")} "$@"\n`);
    fs.chmodSync(path.join(shimDir, "thint"), 0o755);
  }
};

const makeHomeTemplate = () => {
  fs.mkdirSync(homeTemplate, { recursive: true });
  fs.writeFileSync(path.join(homeTemplate, ".gitconfig"), "[user]\n\tname = qa\n\temail = qa@example.com\n[init]\n\tdefaultBranch = main\n");
  execFileSync(binCmd, [...binArgs, "reinit"], {
    stdio: "ignore",
    env: { ...process.env, HOME: homeTemplate, USERPROFILE: homeTemplate, THINT_NO_UPDATE_CHECK: "1" },
  });
};

const runOne = async (scenario, shell, [cols, rows]) => {
  const home = fs.mkdtempSync(path.join(base, "home-"));
  fs.cpSync(homeTemplate, home, { recursive: true, verbatimSymlinks: true });
  const log = path.join(home, "ran.log");
  fs.writeFileSync(log, "");
  for (const [file, text] of rcFor(shell, home)) {
    if (!file) continue;
    fs.mkdirSync(path.dirname(path.resolve(home, file)), { recursive: true });
    fs.writeFileSync(path.resolve(home, file), text);
  }
  const config = { updateCheck: false, ...(scenario.config ?? {}) };
  fs.writeFileSync(
    path.join(home, ".terminalhinterrc"),
    Object.entries(config)
      .map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
      .join("\n") + "\n",
  );
  const projRoot = path.join(home, "Dev");
  fs.mkdirSync(projRoot, { recursive: true });
  fs.cpSync(fixtureTemplate, projRoot, { recursive: true });
  const proj = path.join(projRoot, "shop");
  for (const [file, text] of Object.entries(scenario.files ?? {})) {
    fs.mkdirSync(path.dirname(path.join(proj, file)), { recursive: true });
    fs.writeFileSync(path.join(proj, file), text);
  }
  const cwd = scenario.cwd ? path.join(proj, scenario.cwd) : proj;

  const term = new Terminal({ cols, rows, allowProposedApi: true, scrollback: 2000 });
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    ...(isWin ? { Path: undefined } : {}),
    PATH: `${shimDir}${path.delimiter}${process.env.PATH ?? process.env.Path ?? ""}`,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    THINT_NO_UPDATE_CHECK: "1",
    THINT_NO_ATUIN: "1",
    THINT_NO_ZOXIDE: "1",
    QA_LOG: log,
    PROMPT: shell === "cmd" ? "qa$$ " : undefined,
    ZDOTDIR: undefined,
    XDG_CONFIG_HOME: undefined,
    ISTERM: undefined,
    TMUX: undefined,
    ...(scenario.env ?? {}),
  };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  let raw = "";
  // tmux's default half-second escape-time joins Esc and a key typed after it into Alt+key, for any program inside
  const tmuxConf = path.join(home, ".qa-tmux.conf");
  fs.writeFileSync(tmuxConf, "set -sg escape-time 10\n");
  // inside a multiplexer: thint starts in its first window, the way it does from a shell config there
  const inner = [binCmd, ...binArgs, "-s", shell];
  const quoted = inner.map((a) => `'${a}'`).join(" ");
  const [cmd, cmdArgs] =
    scenario.wrapper === "tmux"
      ? ["tmux", ["-L", `qa-${path.basename(home)}`, "-f", tmuxConf, "new-session", quoted]]
      : scenario.wrapper === "screen"
        ? ["screen", ["-q", "-S", `qa-${path.basename(home)}`, ...inner]]
        : [binCmd, inner.slice(1)];
  if (scenario.wrapper === "tmux") env.TERM = "xterm-256color";
  const p = pty.spawn(cmd, cmdArgs, { name: "xterm-256color", cols, rows, cwd, env });
  let exited = null;
  p.onExit((e) => (exited = e));
  // no run takes longer than two minutes, whatever hangs
  let timedOut = false;
  const cap = setTimeout(() => {
    timedOut = true;
    try {
      p.kill();
    } catch {
      // already gone
    }
  }, 120_000 * slow);
  // what the headless terminal answers (cursor position, device attributes) goes back to the program, as a real
  // terminal does: fish waits 10 s for that answer, PowerShell's line editor never draws without it
  term.onData((d) => {
    if (exited != null) return;
    try {
      p.write(d);
    } catch {
      // the program is gone
    }
  });
  p.onData((d) => {
    raw += d;
    term.write(d);
  });

  const screen = () => {
    const b = term.buffer.active;
    const lines = [];
    for (let y = 0; y < rows; y++) lines.push(b.getLine(b.viewportY + y)?.translateToString(true) ?? "");
    return lines;
  };
  const screenText = () => screen().join("\n");
  // the command line under the cursor, with wrapped rows joined and the prompt taken off
  const currentLine = () => {
    const b = term.buffer.active;
    let y = b.baseY + b.cursorY;
    let text = b.getLine(y)?.translateToString(true) ?? "";
    // rows above belong to the same line while they are wrapped, or (zsh wraps by moving the cursor itself) while
    // the prompt has not been reached yet and the row above is full
    const full = (row) => (b.getLine(row)?.translateToString(false) ?? "").length >= cols && (b.getLine(row)?.translateToString(true) ?? "").length >= cols - 1;
    for (let up = 0; y > 0 && up < 8; up++) {
      if (!b.getLine(y)?.isWrapped && (text.includes(prompt.trimEnd()) || !full(y - 1))) break;
      y--;
      text = (b.getLine(y)?.translateToString(true) ?? "") + text;
    }
    let next = b.baseY + b.cursorY + 1;
    while (b.getLine(next)?.isWrapped) text += b.getLine(next++)?.translateToString(true) ?? "";
    const at = text.lastIndexOf(prompt.trimEnd());
    return (at >= 0 ? text.slice(at + prompt.length) : text).trimEnd();
  };
  const listVisible = () => screen().some((l) => listChars.test(l));
  const ran = () =>
    fs
      .readFileSync(log, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== "");

  const stable = async (quiet = 250, max = 6000) => {
    const start = Date.now();
    let seen = raw.length;
    let since = Date.now();
    while (Date.now() - start < max * slow && !timedOut) {
      await sleep(40);
      if (raw.length !== seen) {
        seen = raw.length;
        since = Date.now();
      } else if (Date.now() - since >= quiet * slow) return;
    }
  };
  const waitFor = async (test, max = 8000) => {
    const start = Date.now();
    while (Date.now() - start < max * slow && !timedOut) {
      if (test()) return true;
      await sleep(50);
    }
    return test();
  };

  // cmd has no Ctrl+U, nor PowerShell on Windows (its line editor is in Windows mode there): Esc empties the line
  // (the first Esc only closes the list when it is open)
  const escClears = shell === "cmd" || (isWin && (shell === "pwsh" || shell === "powershell"));
  const clearCmdLine = async () => {
    p.write("\x1b");
    await sleep(150 * slow);
    p.write("\x1b");
    await sleep(150 * slow);
  };
  const failures = [];
  const fail = (step, msg) => failures.push(`step ${step}: ${msg}`);
  const vars = { shell, cols, rows, home, proj };
  const fill = (s) => String(s).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
  const started = Date.now();
  try {
    // the first prompt: thint started and the shell drew its prompt
    const up = await waitFor(() => screenText().includes(prompt.trimEnd()), 20000);
    if (!up) throw new Error(`no prompt after 20 s; screen:\n${screenText()}`);
    await stable(400);
    // one command first: bash-preexec skips the very first command of a session, and the log starts clean after it
    if (shell !== "cmd") {
      p.write("true\r");
      await stable(300);
      // the log starts clean once that first command is in it (PowerShell writes it a little later)
      if (shell !== "bash") await waitFor(() => ran().includes("true"), 3000);
      fs.writeFileSync(log, "");
    }
    let i = 0;
    for (const raw0 of scenario.steps) {
      i++;
      const step = typeof raw0 === "string" ? { type: raw0 } : raw0;
      if (step.only_shells && !step.only_shells.includes(shell)) continue;
      if (step.skip_shells?.includes(shell)) continue;
      if (step.type != null || step.key != null || step.paste != null) {
        const text = fill(step.type ?? (step.key != null ? `<${step.key}>` : step.paste));
        // a terminal wraps a paste in markers only when the program asked for it (PowerShell does not)
        const bracketedOn = raw.lastIndexOf("\x1b[?2004h") > raw.lastIndexOf("\x1b[?2004l");
        if (step.paste != null) p.write(step.bracketed === false || !bracketedOn ? text : `\x1b[200~${text}\x1b[201~`);
        else
          for (const chunk of toChunks(text)) {
            if (chunk === "\x15" && escClears) await clearCmdLine();
            else p.write(chunk);
            await sleep((step.delay ?? 25) * slow);
          }
        await stable(step.quiet ?? 250);
      }
      if (step.raw != null) {
        p.write(step.raw);
        await stable(step.quiet ?? 250);
      }
      if (step.resize) {
        const [c, r] = step.resize.split("x").map(Number);
        p.resize(c, r);
        term.resize(c, r);
        await stable(300);
      }
      if (step.wait != null) await sleep(step.wait * slow);
      if (step.wait_for != null) {
        const want = fill(step.wait_for);
        if (!(await waitFor(() => screenText().includes(want), step.timeout ?? 8000))) fail(i, `waited for "${want}"; screen:\n${screenText()}`);
      }
      if (step.show) process.stderr.write(`\n--- ${scenario.name} [${shell} ${cols}x${rows}] step ${i}: line "${currentLine()}"\n${screenText()}\n---\n`);
      if (step.expect != null)
        for (const want of [].concat(step.expect).map(fill)) if (!screenText().includes(want)) fail(i, `expected "${want}" on screen; screen:\n${screenText()}`);
      if (step.expect_not != null)
        for (const bad of [].concat(step.expect_not).map(fill)) if (screenText().includes(bad)) fail(i, `did not expect "${bad}" on screen; screen:\n${screenText()}`);
      const listRows = () => screen().filter((l) => l.includes("│")).join("\n");
      if (step.list_has != null)
        for (const want of [].concat(step.list_has).map(fill)) if (!listRows().includes(want)) fail(i, `expected "${want}" in the list; screen:\n${screenText()}`);
      if (step.list_not != null)
        for (const bad of [].concat(step.list_not).map(fill)) if (listRows().includes(bad)) fail(i, `did not expect "${bad}" in the list; screen:\n${screenText()}`);
      if (step.expect_regex != null && !new RegExp(step.expect_regex, "m").test(screenText())) fail(i, `expected /${step.expect_regex}/; screen:\n${screenText()}`);
      if (step.expect_line != null && currentLine() !== fill(step.expect_line)) fail(i, `line is "${currentLine()}", expected "${fill(step.expect_line)}"`);
      if (step.expect_line_starts != null && !currentLine().startsWith(fill(step.expect_line_starts)))
        fail(i, `line is "${currentLine()}", expected it to start with "${fill(step.expect_line_starts)}"`);
      if (step.expect_list === true && !(await waitFor(listVisible, step.timeout ?? 3000))) fail(i, `expected the list; screen:\n${screenText()}`);
      if (step.expect_list === false && listVisible()) fail(i, `expected no list; screen:\n${screenText()}`);
      if (shell !== "cmd") {
        if (step.expect_ran != null) {
          const want = fill(step.expect_ran);
          if (!(await waitFor(() => ran().at(-1) === want, 3000))) fail(i, `last command run was "${ran().at(-1)}", expected "${want}" (all: ${JSON.stringify(ran())})`);
        }
        if (step.expect_ran_count != null && ran().length !== step.expect_ran_count)
          fail(i, `${ran().length} commands ran, expected ${step.expect_ran_count}: ${JSON.stringify(ran())}`);
      }
      if (timedOut) {
        fail(i, "the run took over two minutes and was stopped");
        break;
      }
      if (exited) {
        fail(i, `thint exited (${JSON.stringify(exited)})`);
        break;
      }
    }
    // the shell still answers, and nothing of the list is left on the screen
    if (!exited && !timedOut && scenario.alive !== false) {
      if (escClears) await clearCmdLine();
      else p.write("\x15");
      await stable(200);
      if (listVisible()) {
        p.write("\x1b");
        await stable(200);
      }
      const probe = shell === "fish" ? "echo alive-(math 40+2)" : shell === "cmd" ? "echo alive-42" : shell.includes("sh") && shell !== "pwsh" ? "echo alive-$((40+2))" : 'echo "alive-$(40+2)"';
      for (const ch of probe) {
        p.write(ch);
        await sleep(10);
      }
      await stable(200);
      if (listVisible()) {
        p.write("\x1b");
        await stable(150);
      }
      p.write("\r");
      if (!(await waitFor(() => screenText().includes("alive-42"), 8000))) fail("end", `the shell does not answer; screen:\n${screenText()}`);
      // a command that worked leaves no list behind, and no piece of an earlier one
      else if (scenario.leftover !== true) {
        await stable(300);
        if (listVisible()) fail("end", `a list or a piece of one is left on the screen:\n${screenText()}`);
      }
    }
  } catch (e) {
    failures.push(String(e?.stack ?? e));
  } finally {
    clearTimeout(cap);
    if (scenario.wrapper === "tmux")
      try {
        execFileSync("tmux", ["-L", `qa-${path.basename(home)}`, "kill-server"], { stdio: "ignore" });
      } catch {
        // the server is already gone
      }
    // Leaving the shell the normal way first: on Windows, node-pty's kill() starts a helper that prints
    // "AttachConsole failed" when the runner has no console of its own (as in CI), which is only noise.
    if (exited == null && !timedOut) {
      if (escClears) await clearCmdLine();
      else p.write("\x15");
      p.write("exit\r");
      await waitFor(() => exited != null, 3000);
    }
    if (exited == null)
      try {
        p.kill();
      } catch {
        // already gone
      }
    await waitFor(() => exited != null, 2000);
    if (!keep && failures.length === 0)
      try {
        fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {
        // the shell may still be writing its history; the run folder goes at the end anyway
      }
  }
  return { scenario: scenario.name, shell, size: `${cols}x${rows}`, ok: failures.length === 0, timedOut, ms: Date.now() - started, failures, home: failures.length ? home : undefined, raw: failures.length ? raw.slice(-4000) : undefined };
};

const loadScenarios = () => {
  const dir = path.join(here, "scenarios");
  const all = [];
  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith(".yaml")) continue;
    const docs = YAML.parseAllDocuments(fs.readFileSync(path.join(dir, file), "utf8"));
    for (const doc of docs) {
      const value = doc.toJS();
      if (value == null) continue;
      for (const s of [].concat(value)) all.push({ ...s, file });
    }
  }
  return all;
};

// One run that trips over a closed terminal (a late write after the shell exited) must not end all the others:
// the error is printed and the runs go on.
let strayErrors = 0;
process.on("uncaughtException", (e) => {
  strayErrors++;
  process.stderr.write(`\n(stray error, the runs go on) ${e?.stack ?? e}\n`);
});
process.on("unhandledRejection", (e) => {
  strayErrors++;
  process.stderr.write(`\n(stray rejection, the runs go on) ${e?.stack ?? e}\n`);
});

const main = async () => {
  makeFixture();
  makeShim();
  makeHomeTemplate();
  const scenarios = loadScenarios().filter((s) => !only || s.name.includes(only));
  const installed = shells.filter((s) => {
    const ok = resolveShell(s) !== "";
    if (!ok) process.stderr.write(`skipping ${s}: not installed\n`);
    return ok;
  });
  // A shell that does not even start under thint would fail every scenario slowly (20 s each, twice). One quick
  // start per shell first; a shell that fails it is reported once and its scenarios are not run.
  const startup = { name: "thint starts and the shell answers", steps: [] };
  const broken = [];
  const available = [];
  for (const shell of installed) {
    const r = await runOne(startup, shell, [80, 24]);
    if (r.ok) available.push(shell);
    else {
      broken.push({ ...r, scenario: `${startup.name} (the other scenarios of ${shell} were not run)` });
      process.stderr.write(`✗ ${shell} does not start under thint:\n  ${r.failures.join("\n  ").slice(0, 3000)}\n`);
    }
  }
  const runs = [];
  for (const s of scenarios)
    for (const shell of available) {
      if (s.wrapper && (isWin || which(s.wrapper) === "")) continue;
      if (s.shells && !s.shells.includes(shell)) continue;
      if (s.skip_shells?.includes(shell)) continue;
      for (const size of sizes) {
        if (s.sizes && !s.sizes.includes(`${size[0]}x${size[1]}`)) continue;
        if (s.min_cols && size[0] < s.min_cols) continue;
        runs.push([s, shell, size]);
      }
    }
  process.stderr.write(`${scenarios.length} scenarios, ${runs.length} runs, ${jobs} at a time\n`);
  const results = [...broken];
  // written after every run, so a run that is stopped halfway still leaves what it found
  const save = () =>
    out && fs.writeFileSync(out, JSON.stringify({ platform: process.platform, shells: installed, started: available, planned: runs.length, strayErrors, results }, null, 2));
  save();
  let next = 0;
  let done = 0;
  const startedAt = Date.now();
  const worker = async () => {
    while (next < runs.length) {
      const [s, shell, size] = runs[next++];
      let r = await runOne(s, shell, size);
      // one retry for timing: a pass on the second try is reported as flaky, not as passing
      // no second try for a timeout or once a lot is failing anyway: it only doubles the wait
      if (!r.ok && !flag("no-retry") && !r.timedOut && results.filter((x) => !x.ok).length < 40) {
        const again = await runOne(s, shell, size);
        if (again.ok) r = { ...again, flaky: true, firstFailures: r.failures };
        else r = again;
      }
      results.push(r);
      save();
      done++;
      process.stderr.write(`${r.ok ? (r.flaky ? "~" : ".") : "F"}`);
      if (done % 50 === 0) process.stderr.write(` ${done}/${runs.length} in ${Math.round((Date.now() - startedAt) / 1000)} s\n`);
      if (!r.ok) process.stderr.write(`\n✗ ${r.scenario} [${r.shell} ${r.size}]\n  ${r.failures.join("\n  ").slice(0, 3000)}\n`);
    }
  };
  await Promise.all(Array.from({ length: jobs }, worker));
  const failed = results.filter((r) => !r.ok);
  const flaky = results.filter((r) => r.flaky);
  process.stderr.write(`\n${results.length - failed.length}/${results.length} passed, ${flaky.length} flaky\n`);
  save();
  if (failed.length === 0 && !keep) fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  else process.stderr.write(`homes of the failed runs are in ${base}\n`);
  process.exit(failed.length ? 1 : 0);
};

main();
