# Speed, install and update checks

Layers 7 and 8 of the test plan. Both run against a built binary, through a real terminal (node-pty), with a
fake home folder, so they never touch your own shell setup.

## Speed (`perf.ts`)

```bash
npm run build && npm run package
THINT_BIN=pkg/terminalhinter-linux-x64 npx tsx scripts/qa/perf.ts
```

| Measure | How | Budget |
| --- | --- | --- |
| New tab | prompt time with the startup lines minus the same shell without them, 20 tabs each | median 150 ms more at most |
| Typed before ready | `echo` typed the moment the tab opens runs exactly once | once |
| Key to list drawn | 500 keystrokes on `git ch`, `cd sr`, `npm run ta`, `docker compose up ser`, `kill `, `make tar`, `git stash apply ` and more, in a repo with 5 000 files, 300 branches, 200 tags and 50 stashes | p50 15 ms, p99 50 ms |
| Slow, hanging, offline | typing after `slowcmd ` (sleep 3), `hangcmd ` (never ends) and `npm i react@` with the registry unreachable | echo p99 50 ms |
| Long run | `QA_SOAK_MINUTES=60`: typing for an hour, memory of the thint process every 5 minutes | at most 20% growth after warm-up |

Every row records the machine load next to it. On a busy machine the numbers are the machine's, so the CI run on
a free runner is the one to compare against the budget. `thintTimings` in the JSON report is thint's own time per
step (ISTERM_PERF), which separates its work from waiting for the CPU.

## Install and update (`install.ts`)

```bash
npm run package && npm run package:base
npm i --prefix /tmp/v verdaccio@6
QA_VERDACCIO=/tmp/v/node_modules/.bin/verdaccio npx tsx scripts/qa/install.ts
```

It starts a local npm registry (verdaccio) that serves the published versions and the new build, then for npm,
pnpm, yarn and bun:

1. installs the published version (1.1.3), writes the startup lines, opens a tab and checks the list;
2. updates with that manager while the tab stays open; the old tab keeps working;
3. opens a new tab: it must run the new version on its own, with no `thint reinit`;
4. with `QA_NEXT_PLATFORM_TGZ` and `QA_NEXT_BASE_TGZ` (the same build with a higher version), updates once more
   and checks the next new tab runs that one: this is the update every 1.2.0 user will make next;
5. `thint update --force` finds the manager and reinstalls, `thint doctor` passes;
6. `thint uninstall` plus the manager's remove: the next tab is a plain working shell, no thint files are left.

It also checks a two-Node nvm layout (thint installed under one version, a tab opened with the other on the PATH)
and `bin.js` under every Node version given in `QA_NODES`.

## Only in CI or on a Mac

- Speed on a free 4-core runner, on macOS (zsh 5.9, bash 3.2) and with fish.
- Install and update on macOS: Homebrew Node, the `lsof` path, codesigning of the binary built with the V8 code
  cache.
- Node 18 and 24 (not installed here; 20, 21 and 22 were checked).
- Windows: none of this covers it yet.
