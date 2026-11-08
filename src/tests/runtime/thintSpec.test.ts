// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import { getSuggestions, loadLocalSpecsSet } from "../../runtime/runtime.js";
import { thintSpec } from "../../runtime/thintSpec.js";
import { unpackResources } from "../../utils/node.js";
import { Shell } from "../../utils/shell.js";
import bookmark from "../../commands/bookmark.js";
import config from "../../commands/config.js";
import theme from "../../commands/theme.js";
import specs from "../../commands/specs/root.js";

beforeAll(async () => {
  await unpackResources();
  await loadLocalSpecsSet();
});

const names = async (cmd: string) => (await getSuggestions(cmd, process.cwd(), Shell.Zsh))?.suggestions.map((s) => s.name) ?? [];

test("thint itself is offered as a command", async () => {
  expect(await names("thi")).toContain("thint");
  expect(await names("terminalh")).toContain("terminalhinter");
});

test("thint lists its subcommands, themes and settings", async () => {
  expect(await names("thint ")).toEqual(expect.arrayContaining(["init", "theme", "config", "bookmark", "specs"]));
  expect(await names("thint theme ")).toEqual(expect.arrayContaining(["thint", "light", "nord", "dracula"]));
  expect(await names("thint config set ")).toContain("iconStyle");
  expect(await names("thint config set iconStyle ")).toEqual(["plain", "marks", "badge"]);
  expect(await names("thint config set fuzzyMatching ")).toEqual(["true", "false"]);
});

test("the spec knows every subcommand the CLI has", () => {
  const specNames = (name: string) => {
    const sub = thintSpec.subcommands?.find((s) => s.name === name);
    return (sub?.subcommands ?? []).map((s) => (Array.isArray(s.name) ? s.name[0] : s.name)).sort();
  };
  for (const cmd of [bookmark, config, specs]) expect(specNames(cmd.name())).toEqual(cmd.commands.map((c) => c.name()).sort());
  expect(thintSpec.subcommands?.map((s) => s.name)).toContain(theme.name());
});
