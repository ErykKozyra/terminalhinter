// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import { isSubsequence } from "../../runtime/suggestion.js";

test("matches characters in order, not necessarily next to each other", () => {
  expect(isSubsequence("intercars.com.pl", "icpl")).toBe(true);
  expect(isSubsequence("intercars.com.pl", "ipcl")).toBe(false);
  expect(isSubsequence("checkout", "co")).toBe(true);
  expect(isSubsequence("anything", "")).toBe(true);
});
