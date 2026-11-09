// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// tsc leaves the "__VERSION__" placeholder in build/utils/version.js. The version from package.json goes in here, so
// a build straight from the repo (npm run build, npm i -g .) shows its real version. The release bundle patches the
// same spot later, which is then already done.
import fs from "node:fs";

const file = "build/utils/version.js";
const { version } = JSON.parse(fs.readFileSync("package.json", "utf8"));
fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("__VERSION__", version));
