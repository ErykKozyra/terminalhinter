// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  // [...]
  extensionsToTreatAsEsm: [".ts"],
  globalSetup: "<rootDir>/scripts/jest-global-setup.cjs",
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    // '^.+\\.[tj]sx?$' to process js/ts with `ts-jest`
    // '^.+\\.m?[tj]sx?$' to process js/ts/mjs/mts with `ts-jest`
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
      },
    ],
  },
  testPathIgnorePatterns: ["/node_modules/", "src/tests/ui/", ".tui-test/"],
  // on GitHub, failures also show up as annotations on the run page
  reporters: process.env.GITHUB_ACTIONS ? ["default", ["github-actions", { silent: false }]] : ["default"],
};
