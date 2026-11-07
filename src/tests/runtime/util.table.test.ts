// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import path from "node:path";

import { closest, editDistance, relativeAge, tildify } from "../../runtime/extras/util.js";

const distances: [string, string, number][] = [
  ["git", "git", 0],
  ["gti", "git", 1],
  ["igt", "git", 1],
  ["gi", "git", 1],
  ["gitt", "git", 1],
  ["got", "git", 1],
  ["", "git", 3],
  ["git", "", 3],
  ["kitten", "sitting", 3],
  ["docker", "dokcer", 1],
  ["status", "stauts", 1],
  ["checkout", "chekcout", 1],
  ["abc", "cba", 2],
  ["żółw", "zółw", 1],
  ["a", "b", 1],
];

describe("edit distance", () => {
  test.each(distances)("%s → %s", (a, b, d) => expect(editDistance(a, b, 5)).toBe(d));
  test("stops early past the limit", () => expect(editDistance("aaaaaaaa", "bbbbbbbb", 2)).toBe(3));
  test("different lengths past the limit", () => expect(editDistance("a", "abcdefgh", 2)).toBe(3));
});

const names = ["git", "gh", "go", "gt", "docker", "dotnet", "kubectl", "npm", "npx", "pnpm", "make", "cmake", "ls", "sl", "python3", "python", "terraform"];
const closestCases: [string, string | undefined][] = [
  ["gti", "git"],
  ["igt", "git"],
  ["dokcer", "docker"],
  ["dcoker", "docker"],
  ["kubeclt", "kubectl"],
  ["kubctl", "kubectl"],
  ["pnmp", "pnpm"],
  ["mkae", "make"],
  ["terrafrom", "terraform"],
  ["pyhton", "python"],
  ["pythno3", "python3"],
  ["xyz", undefined],
  ["git", undefined], // the word itself is not a typo
  ["qqqq", undefined],
  ["", undefined],
  ["dockerfile", undefined],
];

describe("the closest name", () => {
  test.each(closestCases)("%s", (word, expected) => expect(closest(word, names)).toBe(expected));
  test("a short word allows one mistake", () => expect(closest("abc", ["xyz", "abd"])).toBe("abd"));
  test("a short word does not allow two", () => expect(closest("abc", ["axy"])).toBeUndefined());
  test("a longer word allows two", () => expect(closest("deplyo", ["deploy"])).toBe("deploy"));
  test("a custom limit", () => expect(closest("mian", ["main", "develop"], 3)).toBe("main"));
});

const second = 1000;
const minute = 60 * second;
const hour = 60 * minute;
const day = 24 * hour;
const ages: [number, string][] = [
  [0, "0 seconds ago"],
  [-5000, "0 seconds ago"],
  [1 * second, "1 second ago"],
  [6 * second, "6 seconds ago"],
  [89 * second, "89 seconds ago"],
  [90 * second, "2 minutes ago"],
  [1 * minute + 31 * second, "2 minutes ago"],
  [45 * minute, "45 minutes ago"],
  [89 * minute, "89 minutes ago"],
  [90 * minute, "2 hours ago"],
  [1 * hour + 30 * minute, "2 hours ago"],
  [35 * hour, "35 hours ago"],
  [36 * hour, "2 days ago"],
  [13 * day, "13 days ago"],
  [14 * day, "2 weeks ago"],
  [69 * day, "10 weeks ago"],
  [70 * day, "2 months ago"],
  [200 * day, "7 months ago"],
  [364 * day, "12 months ago"],
  [365 * day, "1 year ago"],
  [800 * day, "2 years ago"],
];

describe("how old, the way git says it", () => {
  test.each(ages)("%d ms", (ms, text) => expect(relativeAge(ms)).toBe(text));
});

const home = path.join(path.sep, "home", "eryk");
const tildes: [string, string][] = [
  [home, "~"],
  [path.join(home, "Dev"), `~${path.sep}Dev`],
  [path.join(home, "Dev", "shop"), `~${path.sep}Dev${path.sep}shop`],
  [`${home}2`, `${home}2`],
  [path.join(path.sep, "tmp"), path.join(path.sep, "tmp")],
  [path.join(path.sep, "home", "other"), path.join(path.sep, "home", "other")],
];

describe("~ for the home folder", () => {
  test.each(tildes)("%s", (dir, shown) => expect(tildify(dir, home)).toBe(shown));
  test("no home known", () => expect(tildify("/home/eryk/x", "")).toBe("/home/eryk/x"));
});
