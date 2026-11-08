// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// The Nerd Font style is gone. A config written while it existed must still load, with the default look, instead of
// being thrown away as invalid with every other setting in it.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "thint-config-"));
const realHome = process.env.HOME;

beforeAll(() => {
  process.env.HOME = home;
  process.env.USERPROFILE = home;
});
afterAll(() => {
  process.env.HOME = realHome;
  fs.rmSync(home, { recursive: true, force: true });
});

test.each([
  ['iconStyle = "nerd"\ntheme = "nord"\nmaxSuggestions = 9\n', "plain"],
  ['useNerdFont = true\ntheme = "nord"\nmaxSuggestions = 9\n', "plain"],
  ['useNerdFont = true\niconStyle = "badge"\ntheme = "nord"\nmaxSuggestions = 9\n', "badge"],
])("an old config keeps its other settings: %j", async (text, iconStyle) => {
  if (os.homedir() !== home) return; // Windows takes the home from elsewhere; the logic is the same
  fs.writeFileSync(path.join(home, ".terminalhinterrc"), text);
  const { loadConfig, getConfig } = await import("../../utils/config.js");
  await loadConfig();
  expect(getConfig().iconStyle).toBe(iconStyle);
  expect(getConfig().theme).toBe("nord");
  expect(getConfig().maxSuggestions).toBe(9);
});
