// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// Knowing about new versions: a check against the npm registry at most once a day, a one-line notice in a new tab
// once per new version, and how `thint update` installs it again with the tool that installed it. The same file
// remembers the first tab, for a one-time note asking for a star on GitHub.

import fs from "node:fs";
import path from "node:path";

import { allResourcesPath } from "./constants.js";
import { getVersion } from "./version.js";

export const packageName = "@erykkozyra/terminalhinter";
const checkEvery = 24 * 60 * 60 * 1000;
const askForStarAfter = 3 * 24 * 60 * 60 * 1000;

// -1, 0 or 1; a prerelease (1.2.0-beta) comes before its release
export const compareVersions = (a: string, b: string): number => {
  const parse = (v: string) => {
    const [main, pre] = v.trim().replace(/^v/, "").split("-", 2);
    return { parts: main.split(".").map((n) => Number.parseInt(n, 10) || 0), pre };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.parts[i] ?? 0) - (y.parts[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  if (x.pre === y.pre) return 0;
  if (x.pre == null) return 1;
  if (y.pre == null) return -1;
  return x.pre > y.pre ? 1 : -1;
};

// the version tagged latest on npm, or undefined when the registry cannot be reached in time
export const fetchLatestVersion = async (timeoutMs = 3000): Promise<string | undefined> => {
  const registry = (process.env.npm_config_registry ?? "https://registry.npmjs.org").replace(/\/+$/, "");
  try {
    const response = await fetch(`${registry}/-/package/${packageName.replace("/", "%2f")}/dist-tags`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "application/json" },
    });
    if (!response.ok) return;
    const tags = (await response.json()) as { latest?: unknown };
    return typeof tags.latest === "string" ? tags.latest : undefined;
  } catch {
    return;
  }
};

type UpdateState = { checkedAt?: number; latest?: string; notified?: string; firstSeenAt?: number; starAsked?: boolean };

export const updateStatePath = () => process.env.THINT_UPDATE_FILE ?? path.join(allResourcesPath, "update.json");

export const readUpdateState = (): UpdateState => {
  try {
    const parsed = JSON.parse(fs.readFileSync(updateStatePath(), "utf8")) as unknown;
    return parsed != null && typeof parsed === "object" ? (parsed as UpdateState) : {};
  } catch {
    return {};
  }
};

const writeUpdateState = (state: UpdateState) => {
  try {
    fs.mkdirSync(path.dirname(updateStatePath()), { recursive: true });
    fs.writeFileSync(updateStatePath(), JSON.stringify(state) + "\n");
  } catch {
    // an unwritable data folder only means we ask again next time
  }
};

export const updateChecksDisabled = (enabledInConfig: boolean): boolean =>
  !enabledInConfig || process.env.THINT_NO_UPDATE_CHECK === "1" || process.env.CI != null;

// asks the registry when the last answer is more than a day old; never throws, never prints
export const refreshUpdateState = async (now = Date.now()): Promise<UpdateState> => {
  const state = readUpdateState();
  if (state.checkedAt != null && now - state.checkedAt < checkEvery && now >= state.checkedAt) return state;
  const latest = await fetchLatestVersion();
  // remember the attempt even when offline, so a tab without network does not wait on every start
  // read again: another tab may have written while this one waited for npm
  const next = { ...readUpdateState(), checkedAt: now, latest: latest ?? state.latest };
  writeUpdateState(next);
  return next;
};

// the newer version from the last check, when there is one
export const availableUpdate = (state = readUpdateState(), current = getVersion()): string | undefined =>
  state.latest != null && compareVersions(state.latest, current) > 0 ? state.latest : undefined;

// the line to show in a new tab, once per new version
export const takeUpdateNotice = (current = getVersion()): string | undefined => {
  const state = readUpdateState();
  const latest = availableUpdate(state, current);
  if (latest == null || state.notified === latest) return;
  writeUpdateState({ ...state, notified: latest });
  return latest;
};

// true once, in the first tab three days after the first one
export const takeStarNotice = (now = Date.now()): boolean => {
  const state = readUpdateState();
  if (state.starAsked) return false;
  if (state.firstSeenAt == null) {
    writeUpdateState({ ...state, firstSeenAt: now });
    return false;
  }
  if (now - state.firstSeenAt < askForStarAfter) return false;
  writeUpdateState({ ...state, starAsked: true });
  return true;
};

export type Install = { kind: "npm" | "pnpm" | "yarn" | "bun"; command: string; args: string[]; binFolder?: string } | { kind: "source" } | { kind: "unknown" };

// how this copy was installed, from where its binary lives
export const detectInstall = (binary = process.execPath, platform = process.platform): Install => {
  const p = binary.split(path.sep).join("/");
  const spec = `${packageName}@latest`;
  const win = platform === "win32";
  if (/\/\.bun\/install\/global\//.test(p)) return { kind: "bun", command: "bun", args: ["add", "-g", spec] };
  if (/\/\.pnpm\//.test(p) || /\/pnpm\/global\//.test(p)) return { kind: "pnpm", command: "pnpm", args: ["add", "-g", spec] };
  if (/\/yarn\/global\/node_modules\//.test(p) || /\/\.config\/yarn\/global\//.test(p)) return { kind: "yarn", command: "yarn", args: ["global", "add", spec] };
  // the platform binary sits in node_modules of the main package, or next to it
  const npmGlobal = win ? p.match(/^(.*?)\/node_modules\/@erykkozyra\/terminalhinter/) : p.match(/^(.*?)\/lib\/node_modules\/@erykkozyra\/terminalhinter/);
  if (npmGlobal) {
    // <prefix>/lib/node_modules on macOS and Linux, <prefix>/node_modules on Windows; npm sits in <prefix>/bin or <prefix>
    const prefix = npmGlobal[1];
    const binFolder = win ? prefix : `${prefix}/bin`;
    const npm = win ? `${prefix}/npm.cmd` : `${prefix}/bin/npm`;
    const command = fs.existsSync(npm) ? npm : win ? "npm.cmd" : "npm";
    return { kind: "npm", command, args: ["i", "-g", spec], binFolder: fs.existsSync(binFolder) ? binFolder : undefined };
  }
  if (/\/terminalhinter(-[a-z0-9]+-[a-z0-9]+)?(\.exe)?$|\/thint(\.exe)?$/.test(p)) return { kind: "source" };
  return { kind: "unknown" };
};
