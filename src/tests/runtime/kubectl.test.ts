// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getSuggestions, clearTransientSuggestionState } from "../../runtime/runtime.js";
import { kubectlLineFlags } from "../../runtime/project.js";
import { Shell } from "../../utils/shell.js";

// a kubectl that answers like a real one for two contexts, dev and prod, and writes down every call
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thint-kubectl-"));
const bin = path.join(dir, "bin");
const calls = path.join(dir, "calls.log");
const current = path.join(dir, "current");
fs.mkdirSync(bin);
fs.writeFileSync(current, "dev");
fs.writeFileSync(
  path.join(bin, "kubectl"),
  `#!/bin/sh
echo "$*" >> "${calls}"
ctx=$(cat "${current}"); ns=default; all=
for a in "$@"; do
  case "$a" in --context=*) ctx=\${a#--context=};; --namespace=*) ns=\${a#--namespace=};; --all-namespaces) all=1;; esac
done
case "$*" in
  *"config get-contexts"*) printf 'dev\\nprod\\n';;
  *"config use-context"*) for last; do :; done; echo "$last" > "${current}"; echo "Switched to context \\"$last\\".";;
  *"api-resources"*) printf 'pods\\ndeployments\\nnamespaces\\n';;
  *"get namespaces"*) printf '\\ndefault\\n%s-apps\\n' "$ctx";;
  *"get pods"*) if [ -n "$all" ]; then printf '\\n%s-a-pod\\n%s-b-pod\\n' "$ctx" "$ctx"; else printf '\\n%s-%s-pod\\n' "$ctx" "$ns"; fi;;
  *) exit 1;;
esac
`,
  { mode: 0o755 },
);
const oldPath = process.env.PATH;
beforeAll(() => (process.env.PATH = `${bin}${path.delimiter}${oldPath}`));
afterAll(() => {
  process.env.PATH = oldPath;
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});
beforeEach(() => clearTransientSuggestionState());

const names = async (cmd: string) => (await getSuggestions(cmd, dir, Shell.Bash))?.suggestions.map((s) => s.name) ?? [];
const onlyUnix = process.platform === "win32" ? test.skip : test;

describe("kubectl lists", () => {
  onlyUnix("contexts come from the kubeconfig", async () => {
    expect(await names("kubectl config use-context ")).toEqual(expect.arrayContaining(["dev", "prod"]));
    expect(await names("kubectl --context ")).toEqual(expect.arrayContaining(["dev", "prod"]));
  });
  onlyUnix("-n and --namespace list the namespaces", async () => {
    expect(await names("kubectl get pods -n ")).toEqual(expect.arrayContaining(["default", "dev-apps"]));
    expect(await names("kubectl logs --namespace ")).toEqual(expect.arrayContaining(["default", "dev-apps"]));
  });
  onlyUnix("names come from the namespace typed", async () => {
    expect(await names("kubectl get pods ")).toContain("dev-default-pod");
    expect(await names("kubectl get -n dev-apps pods ")).toContain("dev-dev-apps-pod");
    expect(await names("kubectl -n dev-apps get pods ")).toContain("dev-dev-apps-pod");
    expect(await names("kubectl get --namespace=dev-apps pods ")).toContain("dev-dev-apps-pod");
    expect(await names("kubectl get -A pods ")).toEqual(expect.arrayContaining(["dev-a-pod", "dev-b-pod"]));
  });
  onlyUnix("names and namespaces come from the context typed", async () => {
    expect(await names("kubectl --context prod get pods ")).toContain("prod-default-pod");
    expect(await names("kubectl get pods --context=prod -n ")).toContain("prod-apps");
  });
  onlyUnix("after use-context the list is the new cluster's, not the one before", async () => {
    expect(await names("kubectl get pods ")).toContain("dev-default-pod");
    fs.writeFileSync(current, "prod"); // what `kubectl config use-context prod` does
    clearTransientSuggestionState(); // the line was run and emptied
    const after = await names("kubectl get pods ");
    expect(after).toContain("prod-default-pod");
    expect(after).not.toContain("dev-default-pod");
    fs.writeFileSync(current, "dev");
  });
  onlyUnix("within one line the cluster is asked once", async () => {
    fs.writeFileSync(calls, "");
    await names("kubectl get pods ");
    await names("kubectl get pods d");
    await names("kubectl get pods de");
    const podCalls = fs
      .readFileSync(calls, "utf8")
      .split("\n")
      .filter((l) => l.includes("get pods"));
    expect(podCalls.length).toBe(1);
  });
});

describe("kubectlLineFlags", () => {
  test("reads the flags, not the word being typed", () => {
    expect(kubectlLineFlags(["kubectl", "--context", "prod", "-n", "apps", "get", "pods", ""])).toEqual({
      context: ["--context=prod"],
      namespace: ["--namespace=apps"],
    });
    expect(kubectlLineFlags(["kubectl", "get", "pods", "-n", "ap"])).toEqual({ context: [], namespace: [] });
    expect(kubectlLineFlags(["kubectl", "--kubeconfig=/k/c", "-napps", "get", ""])).toEqual({
      context: ["--kubeconfig=/k/c"],
      namespace: ["--namespace=apps"],
    });
    expect(kubectlLineFlags(["kubectl", "get", "pods", "-A", ""]).namespace).toEqual(["--all-namespaces"]);
  });
});
