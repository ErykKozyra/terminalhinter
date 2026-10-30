// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

module.exports = {
  env: {
    es2021: true,
    node: true,
  },
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended", "plugin:react/recommended", "prettier"],
  overrides: [
    {
      env: {
        node: true,
      },
      files: [".eslintrc.{js,cjs}"],
      parserOptions: {
        sourceType: "script",
      },
    },
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
  plugins: ["@typescript-eslint", "react", "header"],
  // files from upstream keep the Microsoft notice, files written for terminalhinter carry their own
  rules: { "header/header": [2, "line", [{ pattern: "^ Copyright \\(c\\) (Microsoft Corporation|20\\d\\d Eryk Kozyra)\\.$", template: " Copyright (c) 2026 Eryk Kozyra." }, " Licensed under the MIT License."]] },
  settings: {
    react: {
      version: "detect",
    },
  },
};
