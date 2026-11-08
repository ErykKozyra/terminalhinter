// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import { splitSpec, versionGenerator, versionSuggestions } from "../../runtime/extras/versions.js";

const specs: [string, [string, string] | undefined][] = [
  ["react@", ["react", ""]],
  ["react@18", ["react", "18"]],
  ["react@18.3.1", ["react", "18.3.1"]],
  ["react@next", ["react", "next"]],
  ["react@^18.2.0", ["react", "^18.2.0"]],
  ["@types/node@", ["@types/node", ""]],
  ["@types/node@20", ["@types/node", "20"]],
  ["@scope/pkg.name@1", ["@scope/pkg.name", "1"]],
  ["lodash.debounce@4", ["lodash.debounce", "4"]],
  ["my_pkg@1", ["my_pkg", "1"]],
  ["React@1", ["React", "1"]],
  ["react", undefined],
  ["@types/node", undefined],
  ["@types", undefined],
  ["@", undefined],
  ["", undefined],
  ["@scope/@x", undefined],
  ["./local@1", undefined],
  ["git+https://x@y", undefined],
  ["user@host", ["user", "host"]], // shaped like a package spec; only offered after npm i / pnpm add
];

describe("splitting name@version", () => {
  test.each(specs)("%s", (token, expected) => expect(splitSpec(token)).toEqual(expected));
});

const doc = {
  "dist-tags": { latest: "19.1.0", next: "19.2.0-rc.1", canary: "19.2.0-canary.3", beta: "19.0.0-beta.2" },
  versions: Object.fromEntries(
    [
      "17.0.2",
      "18.0.0",
      "18.2.0",
      "18.3.1",
      "19.0.0",
      "19.0.0-beta.2",
      "19.0.1",
      "19.1.0",
      "19.2.0-canary.3",
      "19.2.0-rc.1",
      "19.2.0-canary.10",
      "9.0.0",
      "10.0.0",
      "19.1.0+build.5",
    ].map((v) => [v, v === "17.0.2" ? { deprecated: "old" } : {}]),
  ),
};

describe("version suggestions", () => {
  const out = versionSuggestions("react", doc);
  const names = out.map((s) => s.name as string);
  test("tags first, latest on top", () => expect(names.slice(0, 4)).toEqual(["latest", "beta", "canary", "next"]));
  const releases = names.slice(4).filter((n) => !n.includes("-"));
  test("releases newest first, by number not by text", () =>
    expect(releases.filter((r) => !r.includes("+"))).toEqual(["19.1.0", "19.0.1", "19.0.0", "18.3.1", "18.2.0", "18.0.0", "17.0.2", "10.0.0", "9.0.0"]));
  test("prereleases after every release", () => {
    const firstPre = names.findIndex((n, i) => i >= 4 && n.includes("-"));
    const lastRelease = names.length - 1 - [...names].reverse().findIndex((n) => !n.includes("-"));
    expect(firstPre).toBeGreaterThan(lastRelease);
  });
  test("build metadata does not change the order", () => {
    const list = versionSuggestions("x", { versions: { "1.2.2": {}, "1.2.3+build.9": {}, "1.10.0": {} } }).map((s) => s.name);
    expect(list).toEqual(["1.10.0", "1.2.3+build.9", "1.2.2"]);
  });
  test("a tag's version says so", () => expect(out.find((s) => s.name === "19.1.0")?.description).toBe("latest"));
  test("deprecated says so", () => expect(out.find((s) => s.name === "17.0.2")?.description).toBe("deprecated"));
  test("insert value is the whole spec with a space", () => expect(out.find((s) => s.name === "18.3.1")?.insertValue).toBe("react@18.3.1 "));
  test("every entry is a version entry", () => expect(out.every((s) => s.kind === "version")).toBe(true));
  test("no tags, no versions", () => expect(versionSuggestions("x", {})).toEqual([]));
  test("at most 30 releases and 10 prereleases", () => {
    const many = {
      versions: Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`1.${i}.0`, {}]).concat(Array.from({ length: 30 }, (_, i) => [`2.0.0-rc.${i}`, {}]))),
    };
    const list = versionSuggestions("x", many);
    expect(list.filter((s) => !(s.name as string).includes("-")).length).toBe(30);
    expect(list.filter((s) => (s.name as string).includes("-")).length).toBe(10);
    expect(list[0].name).toBe("1.79.0");
  });
});

const triggers: [string, string, boolean][] = [
  ["react@", "react", true],
  // the version typed so far narrows the list, so it is worked out again; the registry answer is remembered
  ["react@1", "react@", true],
  ["react@18", "react@1", true],
  ["react@18", "react@18", false],
  ["vue@", "react@18", true],
  ["react", "react@", true],
  ["@types/node@", "@types/node", true],
  ["@types/node@2", "@types/node@", true],
  ["@types/node@2", "@types/node@2", false],
];

describe("asking the registry again", () => {
  const trigger = versionGenerator.trigger as (a: string, b: string) => boolean;
  test.each(triggers)("%s after %s", (now, before, again) => expect(trigger(now, before)).toBe(again));
  const query = versionGenerator.getQueryTerm as (t: string) => string;
  test.each([
    ["react@18", "18"],
    ["react@", ""],
    ["@types/node@2", "2"],
    ["react", "react"],
  ])("filters %s by %s", (token, term) => expect(query(token)).toBe(term));
});
