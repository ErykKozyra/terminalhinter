// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { availableUpdate, compareVersions, detectInstall, refreshUpdateState, takeUpdateNotice, updateChecksDisabled } from "../../utils/update.js";
import { getShellConfig, Shell } from "../../utils/shell.js";

const folder = fs.mkdtempSync(path.join(os.tmpdir(), "thint-update-"));
const stateFile = path.join(folder, "update.json");

beforeEach(() => {
  process.env.THINT_UPDATE_FILE = stateFile;
  fs.rmSync(stateFile, { force: true });
});

afterAll(() => {
  delete process.env.THINT_UPDATE_FILE;
  fs.rmSync(folder, { recursive: true, force: true });
});

test("compares versions by number, a prerelease before its release", () => {
  expect(compareVersions("1.1.10", "1.1.9")).toBe(1);
  expect(compareVersions("1.2.0", "1.10.0")).toBe(-1);
  expect(compareVersions("v1.1.2", "1.1.2")).toBe(0);
  expect(compareVersions("1.2.0-beta", "1.2.0")).toBe(-1);
  expect(compareVersions("2.0.0", "1.99.99")).toBe(1);
});

test("the notice shows once per new version", () => {
  fs.writeFileSync(stateFile, JSON.stringify({ checkedAt: Date.now(), latest: "1.2.0" }));
  expect(takeUpdateNotice("1.1.2")).toBe("1.2.0");
  expect(takeUpdateNotice("1.1.2")).toBeUndefined();
  fs.writeFileSync(stateFile, JSON.stringify({ checkedAt: Date.now(), latest: "1.3.0", notified: "1.2.0" }));
  expect(takeUpdateNotice("1.1.2")).toBe("1.3.0");
});

test("no notice when this is the newest version, or newer than npm", () => {
  fs.writeFileSync(stateFile, JSON.stringify({ checkedAt: Date.now(), latest: "1.1.2" }));
  expect(takeUpdateNotice("1.1.2")).toBeUndefined();
  expect(availableUpdate({ latest: "1.1.1" }, "1.1.2")).toBeUndefined();
});

test("asks the registry at most once a day", async () => {
  const original = global.fetch;
  const calls: string[] = [];
  global.fetch = (async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify({ latest: "9.0.0" }), { status: 200 });
  }) as typeof fetch;
  try {
    const now = Date.now();
    expect((await refreshUpdateState(now)).latest).toBe("9.0.0");
    await refreshUpdateState(now + 60 * 60 * 1000);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("/-/package/@erykkozyra%2fterminalhinter/dist-tags");
    await refreshUpdateState(now + 25 * 60 * 60 * 1000);
    expect(calls).toHaveLength(2);
  } finally {
    global.fetch = original;
  }
});

test("offline keeps the last answer and does not ask again right away", async () => {
  const original = global.fetch;
  let calls = 0;
  global.fetch = (async () => {
    calls++;
    throw new Error("offline");
  }) as typeof fetch;
  try {
    fs.writeFileSync(stateFile, JSON.stringify({ checkedAt: 0, latest: "1.5.0" }));
    const now = Date.now();
    expect((await refreshUpdateState(now)).latest).toBe("1.5.0");
    await refreshUpdateState(now + 1000);
    expect(calls).toBe(1);
  } finally {
    global.fetch = original;
  }
});

test("checks can be turned off", () => {
  expect(updateChecksDisabled(false)).toBe(true);
  const ci = process.env.CI;
  delete process.env.CI;
  process.env.THINT_NO_UPDATE_CHECK = "1";
  expect(updateChecksDisabled(true)).toBe(true);
  delete process.env.THINT_NO_UPDATE_CHECK;
  expect(updateChecksDisabled(true)).toBe(false);
  if (ci != null) process.env.CI = ci;
});

test("knows how it was installed from where its binary lives", () => {
  const npm = detectInstall("/Users/e/.nvm/versions/node/v22.1.0/lib/node_modules/@erykkozyra/terminalhinter-darwin-arm64/terminalhinter-darwin-arm64", "darwin");
  expect(npm.kind).toBe("npm");
  if (npm.kind === "npm") expect(npm.args).toEqual(["i", "-g", "@erykkozyra/terminalhinter@latest"]);
  expect(detectInstall("/opt/homebrew/lib/node_modules/@erykkozyra/terminalhinter-darwin-arm64/terminalhinter-darwin-arm64", "darwin").kind).toBe("npm");
  const nested = detectInstall(
    "/tmp/nowhere/lib/node_modules/@erykkozyra/terminalhinter/node_modules/@erykkozyra/terminalhinter-linux-x64/terminalhinter-linux-x64",
    "linux",
  );
  expect(nested.kind === "npm" && nested.command).toBe("npm"); // no npm in /tmp/nowhere/bin, so the one on the PATH
  const windows = detectInstall("C:/Users/e/AppData/Roaming/npm/node_modules/@erykkozyra/terminalhinter/node_modules/@erykkozyra/terminalhinter-win32-x64/terminalhinter-win32-x64.exe", "win32");
  expect(windows.kind).toBe("npm");
  expect(
    detectInstall(
      "/Users/e/Library/pnpm/global/5/.pnpm/@erykkozyra+terminalhinter-darwin-arm64@1.1.2/node_modules/@erykkozyra/terminalhinter-darwin-arm64/terminalhinter-darwin-arm64",
      "darwin",
    ).kind,
  ).toBe("pnpm");
  expect(detectInstall("/Users/e/.bun/install/global/node_modules/@erykkozyra/terminalhinter-darwin-arm64/terminalhinter-darwin-arm64", "darwin").kind).toBe("bun");
  expect(detectInstall("/Users/e/.local/bin/thint", "darwin").kind).toBe("source");
  expect(detectInstall("/usr/local/bin/node", "darwin").kind).toBe("unknown");
});

test("a new tab starts the updated binary when the launcher still holds the old one", () => {
  const config = getShellConfig(Shell.Zsh, "/home/e/.local/share/terminalhinter/bin/zsh", "/home/e/node_modules/@erykkozyra/terminalhinter-linux-x64/terminalhinter-linux-x64");
  expect(config).toContain(`__is_binary='/home/e/node_modules/@erykkozyra/terminalhinter-linux-x64/terminalhinter-linux-x64'`);
  expect(config).toContain(`[[ -x "$__is_binary" && ! "$__is_launcher" -ef "$__is_binary" ]] && __is_launcher=$__is_binary`);
  expect(getShellConfig(Shell.Zsh)).not.toContain("__is_binary");
});
