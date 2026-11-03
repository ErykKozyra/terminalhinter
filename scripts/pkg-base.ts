// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Constants
const PKG_DIR = "pkg";
const SCRIPTS_DIR = "scripts";

const getVersion = (): string => {
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf-8"));
  return packageJson.version;
};

const copyFiles = (): void => {
  const mdFiles = fs.readdirSync(process.cwd()).filter((file) => file.endsWith(".md"));
  for (const file of mdFiles) {
    fs.copyFileSync(file, path.join(PKG_DIR, file));
  }
  fs.copyFileSync("LICENSE", path.join(PKG_DIR, "LICENSE"));
  fs.copyFileSync(path.join(SCRIPTS_DIR, "bin.js"), path.join(PKG_DIR, "bin.js"));
};

const generatePackageJson = (): void => {
  const packageJson = {
    name: `@erykkozyra/terminalhinter`,
    version: getVersion(),
    description: "IDE-style terminal autocomplete: a dropdown for folders, git, npm and 600+ CLIs",
    license: "MIT",
    homepage: "https://github.com/ErykKozyra/terminalhinter#readme",
    repository: {
      type: "git",
      url: "git+https://github.com/ErykKozyra/terminalhinter.git",
    },
    author: {
      name: "Eryk Kozyra",
    },
    contributors: [{ name: "Microsoft Corporation", url: "https://github.com/microsoft/inshellisense" }],
    keywords: ["autocomplete", "terminal", "shell", "zsh", "bash", "fish", "completion", "cli"],
    bugs: {
      url: "https://github.com/ErykKozyra/terminalhinter/issues",
    },
    bin: {
      thint: "bin.js",
      terminalhinter: "bin.js",
    },
    files: ["*.md", "LICENSE", "bin.js"],
    optionalDependencies: {
      "@erykkozyra/terminalhinter-darwin-x64": getVersion(),
      "@erykkozyra/terminalhinter-darwin-arm64": getVersion(),
      "@erykkozyra/terminalhinter-linux-x64": getVersion(),
      "@erykkozyra/terminalhinter-linux-arm64": getVersion(),
      "@erykkozyra/terminalhinter-win32-x64": getVersion(),
      "@erykkozyra/terminalhinter-win32-arm64": getVersion(),
    },
  };
  fs.writeFileSync(path.join(PKG_DIR, "package.json"), JSON.stringify(packageJson, null, 2), "utf-8");
};

const packageBase = (): void => {
  execSync(`cd ${PKG_DIR} && npm pack`, { stdio: "inherit" });
};

const main = async (): Promise<void> => {
  copyFiles();
  generatePackageJson();
  packageBase();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
