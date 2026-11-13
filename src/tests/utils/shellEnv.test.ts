// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import fs from "node:fs";

import { commandEnv, createShellEnvFile, parseShellEnv, readShellEnvFile, resetShellEnv, setShellEnv, shellEnvSeparator } from "../../utils/shellEnv.js";
import { buildExecuteShellCommand } from "../../runtime/utils.js";

afterEach(() => resetShellEnv());

const report = (entries: string[]) => entries.join(shellEnvSeparator) + shellEnvSeparator;

describe("parseShellEnv", () => {
  test("reads NAME=value pairs, values may hold = and new lines", () => {
    const env = parseShellEnv(report(["PATH=/a:/b", "KUBECONFIG=/k/config", "X=a=b", "Y=line1\nline2", "EMPTY="]));
    expect(env).toEqual({ PATH: "/a:/b", KUBECONFIG: "/k/config", X: "a=b", Y: "line1\nline2", EMPTY: "" });
  });
  test("a report without PATH is ignored", () => {
    expect(parseShellEnv(report(["HOME=/h"]))).toBeUndefined();
    expect(parseShellEnv("")).toBeUndefined();
  });
  test("Windows spells it Path", () => {
    expect(parseShellEnv(report(["Path=C:\\bin"]), "linux")?.Path).toBe("C:\\bin");
  });
  test("on Windows a /c/... PATH from Git Bash is dropped and the rest is laid over terminalhinter's own", () => {
    const env = parseShellEnv(report(["PATH=/usr/bin:/c/Windows", "AWS_PROFILE=prod"]), "win32")!;
    expect(env.AWS_PROFILE).toBe("prod");
    expect(env.PATH === "/usr/bin:/c/Windows").toBe(false);
  });
});

describe("commandEnv", () => {
  test("is terminalhinter's own until the shell reports", () => {
    expect(commandEnv()).toBe(process.env);
    setShellEnv(parseShellEnv(report(["PATH=/only/this", "AWS_PROFILE=prod"])));
    expect(commandEnv()).toEqual({ PATH: "/only/this", AWS_PROFILE: "prod" });
  });
  test("a broken report keeps the last good one", () => {
    setShellEnv(parseShellEnv(report(["PATH=/good"])));
    setShellEnv(parseShellEnv("garbage"));
    expect(commandEnv().PATH).toBe("/good");
  });
});

const unixTest = process.platform === "win32" ? test.skip : test;

unixTest("the commands behind the lists run with the shell's environment", async () => {
  setShellEnv({ PATH: process.env.PATH, THINT_FROM_SHELL: "yes" });
  const run = buildExecuteShellCommand(5000);
  const out = await run({ command: "printenv", args: ["THINT_FROM_SHELL"] });
  expect(out.stdout.trim()).toBe("yes");
});

describe("the env file", () => {
  test("is private, and a report written to it becomes the environment", () => {
    const file = createShellEnvFile()!;
    if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o077).toBe(0);
    fs.writeFileSync(file, report(["PATH=/from/file", "KUBECONFIG=/k"]));
    readShellEnvFile(file);
    expect(commandEnv().KUBECONFIG).toBe("/k");
  });
  test("a missing file leaves the environment alone", () => {
    readShellEnvFile("/nonexistent/thint-env");
    expect(commandEnv()).toBe(process.env);
  });
});
