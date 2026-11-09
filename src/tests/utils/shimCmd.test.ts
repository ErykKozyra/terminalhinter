// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import { isShimCmd } from "../../utils/shell.js";

test("the cmd.exe npm runs thint.cmd in is told apart from a cmd you work in", () => {
  expect(isShimCmd("cmd.exe", 'C:\\WINDOWS\\system32\\cmd.exe /d /s /c ""C:\\Users\\me\\AppData\\Roaming\\npm\\thint.cmd" init"')).toBe(true);
  expect(isShimCmd("cmd.exe", '"C:\\WINDOWS\\system32\\cmd.exe" ')).toBe(false);
  expect(isShimCmd("cmd.exe", undefined)).toBe(false);
  expect(isShimCmd("pwsh.exe", "pwsh.exe /c x")).toBe(false);
});

test("a PowerShell started to run something does not start the list, whatever way the flag is written", async () => {
  const { getShellConfig, Shell } = await import("../../utils/shell.js");
  const config = getShellConfig(Shell.Powershell);
  const pattern = (name: string) => new RegExp(config.match(new RegExp(`\\$${name} = .*?-imatch '([^']+)'`))![1], "i");
  const command = pattern("__IsCommandFlag");
  for (const flag of ["/c", "-c", "-Command", "/command", "-com", "-File", "-f", "-EncodedCommand", "-enc", "-ec", "-NonInteractive", "-noni"])
    expect(command.test(flag)).toBe(true);
  for (const flag of ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "-ex", "-ep", "-NoExit", "x"]) expect(command.test(flag)).toBe(false);
  const noExit = pattern("__IsNoExitFlag");
  expect(["-NoExit", "/noexit", "-noe"].every((f) => noExit.test(f))).toBe(true);
});
