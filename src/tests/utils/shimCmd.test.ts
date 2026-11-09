// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import { isShimCmd } from "../../utils/shell.js";

test("the cmd.exe npm runs thint.cmd in is told apart from a cmd you work in", () => {
  expect(isShimCmd("cmd.exe", 'C:\\WINDOWS\\system32\\cmd.exe /d /s /c ""C:\\Users\\me\\AppData\\Roaming\\npm\\thint.cmd" init"')).toBe(true);
  expect(isShimCmd("cmd.exe", '"C:\\WINDOWS\\system32\\cmd.exe" ')).toBe(false);
  expect(isShimCmd("cmd.exe", undefined)).toBe(false);
  expect(isShimCmd("pwsh.exe", "pwsh.exe /c x")).toBe(false);
});
