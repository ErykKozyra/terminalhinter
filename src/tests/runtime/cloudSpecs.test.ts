// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getSpecNames, getSuggestions } from "../../runtime/runtime.js";
import { findFixes } from "../../runtime/extras/fixes.js";
import { closest, pathCommands } from "../../runtime/extras/util.js";
import { Shell } from "../../utils/shell.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thint-cloud-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

const names = async (cmd: string) => (await getSuggestions(cmd, dir, Shell.Zsh))?.suggestions.map((s) => s.name) ?? [];

describe("aws and gcloud", () => {
  test("are in the command list, az is not", () => {
    const specs = getSpecNames();
    expect(specs).toContain("aws");
    expect(specs).toContain("gcloud");
    expect(specs).not.toContain("az");
  });
  test("aws completes services, their commands and options", async () => {
    expect(await names("aws ")).toEqual(expect.arrayContaining(["s3", "ec2", "lambda", "iam"]));
    expect(await names("aws s3 ")).toEqual(expect.arrayContaining(["ls", "cp", "mv", "rm", "sync"]));
    expect(await names("aws ec2 describe-in")).toContain("describe-instances");
    expect(await names("aws s3 cp --")).toEqual(expect.arrayContaining(["--recursive", "--dryrun"]));
  }, 30_000);
  test("gcloud completes groups and commands", async () => {
    expect(await names("gcloud ")).toEqual(expect.arrayContaining(["compute", "auth", "config"]));
    expect(await names("gcloud compute instances ")).toEqual(expect.arrayContaining(["create", "delete", "list"]));
  }, 30_000);
  test("the commands around them are unchanged", async () => {
    expect(await names("aw")).toEqual(expect.arrayContaining(["aws", "aws-vault"]));
    expect(await names("git ch")).toContain("checkout");
  });
});

describe("a mistyped command prefers what is installed", () => {
  const notFound = (command: string) => ({ command, exitCode: 127, output: `zsh: command not found: ${command.split(" ")[0]}`, cwd: dir });
  test("a program on PATH wins a tie over one that only has a spec", async () => {
    const fixes = await findFixes(
      notFound("awl -F, '{print $1}' x"),
      () => ["aws", "awk"],
      async () => [],
      () => new Set(["awk"]),
    );
    expect(fixes[0].command).toBe("awk -F, '{print $1}' x");
  });
  test("a spec without the program is still offered when nothing installed is near", async () => {
    const fixes = await findFixes(
      notFound("was s3 ls"),
      () => ["aws", "git"],
      async () => [],
      () => new Set(["git"]),
    );
    expect(fixes[0].command).toBe("aws s3 ls");
  });
  test("a program on PATH wins even over a closer name that only has a spec", async () => {
    const fixes = await findFixes(
      notFound("cls"),
      () => ["sls", "ls"],
      async () => [],
      () => new Set(["ls"]),
    );
    expect(fixes[0].command).toBe("ls");
  });
  test("with both installed, the letter next to the one typed wins", async () => {
    const fixes = await findFixes(
      notFound("awl -F, '{print $1}' x"),
      () => ["aws", "awk"],
      async () => [],
      () => new Set(["aws", "awk"]),
    );
    expect(fixes[0].command).toBe("awk -F, '{print $1}' x");
    expect(closest("gut", ["git", "gzt"])).toBe("git");
  });
  test("closest keeps its old answer without a preferred set", () => {
    expect(closest("gti", ["git", "gt"])).toBe("git");
    expect(closest("awl", ["aws", "awk"], undefined, new Set(["aws"]))).toBe("aws");
  });
});

describe("pathCommands", () => {
  test("lists the programs in the PATH folders", () => {
    const bin = fs.mkdtempSync(path.join(dir, "bin-"));
    fs.writeFileSync(path.join(bin, "mytool"), "");
    expect(pathCommands({ PATH: [bin, path.join(dir, "missing")].join(path.delimiter) }, "linux").has("mytool")).toBe(true);
  });
  test("on Windows the names come without the extension", () => {
    const bin = fs.mkdtempSync(path.join(dir, "win-"));
    for (const f of ["Node.exe", "npm.cmd", "readme.txt"]) fs.writeFileSync(path.join(bin, f), "");
    const found = pathCommands({ Path: bin, PATHEXT: ".EXE;.CMD" }, "win32");
    expect([...found].sort()).toEqual(["node", "npm"]);
  });
});

describe("a spec part withfig does not ship", () => {
  test("gcloud alpha gives an empty list instead of an error", async () => {
    await expect(getSuggestions("gcloud alpha ", dir, Shell.Zsh)).resolves.not.toThrow();
    expect(await names("gcloud alph")).toContain("alpha");
    expect(await names("gcloud compute ")).toContain("instances");
  });
});
