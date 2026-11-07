// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import { riskOfEntry, riskOfLine, riskOfValue } from "../../runtime/extras/risk.js";

// [words before, the entry, risky?]
const entries: [string, string, boolean][] = [
  ["git push", "--force", true],
  ["git push", "-f", true],
  ["git push origin main", "--force", true],
  ["git push", "--force-with-lease", true],
  ["git push", "--delete", true],
  ["git push", "-d", true],
  ["git push", "--mirror", true],
  ["git push", "--tags", false],
  ["git push", "-u", false],
  ["git push", "--set-upstream", false],
  ["git push", "--dry-run", false],
  ["git push", "-n", false],
  ["git reset", "--hard", true],
  ["git reset", "--soft", false],
  ["git reset", "--mixed", false],
  ["git clean", "-f", true],
  ["git clean", "-fd", true],
  ["git clean", "-xdf", true],
  ["git clean", "-n", false],
  ["git clean", "-dn", false],
  ["git checkout", "-f", true],
  ["git checkout", "--force", true],
  ["git checkout", "-b", false],
  ["git branch", "-D", true],
  ["git branch", "-d", false],
  ["git branch", "-a", false],
  ["git stash", "clear", true],
  ["git stash", "drop", true],
  ["git stash", "pop", false],
  ["git stash", "list", false],
  ["git", "push", false],
  ["git", "reset", false],
  ["git commit", "--force", false],
  ["git fetch", "-f", false],
  ["rm", "-r", true],
  ["rm", "-R", true],
  ["rm", "-rf", true],
  ["rm", "-fr", true],
  ["rm", "-f", true],
  ["rm", "-i", false],
  ["rm", "-v", false],
  ["rm", "--verbose", false],
  ["docker system", "prune", true],
  ["docker volume", "prune", true],
  ["docker system prune", "-a", true],
  ["docker system prune", "--all", true],
  ["docker image", "prune", false],
  ["docker system", "df", false],
  ["docker compose down", "-v", true],
  ["docker compose down", "--volumes", true],
  ["docker compose down", "--remove-orphans", false],
  ["docker compose up", "-d", false],
  ["kubectl", "delete", true],
  ["kubectl", "get", false],
  ["kubectl", "apply", false],
  ["terraform", "destroy", true],
  ["terraform", "plan", false],
  ["terraform apply", "-auto-approve", true],
  ["terraform apply", "-var", false],
  ["npm", "unpublish", true],
  ["npm unpublish", "--force", true],
  ["npm", "publish", false],
  ["npm", "install", false],
  ["chmod", "-R", true],
  ["chmod", "+x", false],
  ["chown", "-R", true],
  ["chown", "-h", false],
  ["dd", "of=/dev/sda", true],
  ["dd", "if=/dev/zero", false],
  ["mkfs", "-t", true],
  ["kill", "-9", true],
  ["kill", "-15", false],
  ["kill", "-l", false],
  // the same name under another command is not risky
  ["ls", "-r", false],
  ["grep", "-r", false],
  ["cp", "-r", false],
  ["cp", "-f", false],
  ["svn", "delete", false],
  ["", "--force", false],
];

describe("risky options and subcommands", () => {
  test.each(entries)("%s %s", (before, name, risky) => {
    const words = before.split(" ").filter(Boolean);
    expect(riskOfEntry(words, name) != null).toBe(risky);
  });
});

// values: branches, hosts, scripts, contexts, services
const values: [string, boolean][] = [
  ["prod", true],
  ["production", true],
  ["Prod", true],
  ["PROD", true],
  ["prod-db", true],
  ["db-prod", true],
  ["db_prod", true],
  ["prod2", true],
  ["eu-prod-1", true],
  ["deploy:prod", true],
  ["deploy:production", true],
  ["release/production", true],
  ["arn:aws:eks:eu-west-1:1:cluster/prod", true],
  ["gke_myproj_europe-west1_prod-cluster", true],
  ["LIVE-DB", true],
  ["LIVE", true],
  ["MAIN-SERVER", true],
  ["DB01", false], // two letters is too little to tell
  ["LIVE_DB", false], // written like an environment variable
  ["product", false],
  ["products", false],
  ["productivity", false],
  ["reproduce", false],
  ["prodigy", false],
  ["PRODUCT_ID", false],
  ["byproduct", false],
  ["nonprod", false],
  ["non-prod", false],
  ["non_prod", false],
  ["notprod", false],
  ["staging", false],
  ["dev", false],
  ["main", false],
  ["master", false],
  ["feature/prodigy", false],
  ["HEAD", false],
  ["FETCH_HEAD", false],
  ["ORIG_HEAD", false],
  ["README", false],
  ["LICENSE", false],
  ["TODO", false],
  ["CHANGELOG", false],
  ["CODEOWNERS", false],
  ["POST", false],
  ["DELETE", false],
  ["GET", false],
  ["PATH", false],
  ["HOME", false],
  ["SIGTERM", false],
  ["SIGKILL", false],
  ["SIGUSR1", false],
  ["JSON", false],
  ["CI", false],
  ["OK", false],
  ["v1.2.0", false],
  ["web", false],
  ["api", false],
  ["", false],
];

describe("risky values", () => {
  test.each(values)("%s", (name, risky) => {
    expect(riskOfValue(name) != null).toBe(risky);
  });
});

// whole lines, as Ctrl+G sees them
const lines: [string, string[]][] = [
  ["git reset --hard HEAD~1", ["--hard"]],
  ["git push --force origin main", ["--force", "force push to a main branch"]],
  ["git push -f origin master", ["-f", "force push to a main branch"]],
  ["git push --force origin feature/x", ["--force"]],
  ["git push origin main", []],
  ["git push --force-with-lease=main origin main", ["--force-with-lease=main"]],
  ["rm -rf /", ["-rf", "deletes a whole tree"]],
  ["rm -rf ~", ["-rf", "deletes a whole tree"]],
  ["rm -rf ~/", ["-rf", "deletes a whole tree"]],
  ["rm -rf *", ["-rf", "deletes a whole tree"]],
  ["rm -rf .", ["-rf", "deletes a whole tree"]],
  ["rm -rf ..", ["-rf", "deletes a whole tree"]],
  ["rm -rf ./node_modules", ["-rf"]],
  ["rm -rf dist build", ["-rf"]],
  ["rm file.txt", []],
  ["rm -i file.txt", []],
  ["kubectl --context prod delete pod x", ["delete", "kubectl against a production context"]],
  ["kubectl --context=production get pods", ["kubectl against a production context"]],
  ["kubectl --context staging get pods", []],
  ["kubectl --context non-prod get pods", ["kubectl against a production context"]],
  ["docker compose down -v", ["-v"]],
  ["docker compose down", []],
  ["terraform destroy", ["destroy"]],
  ["terraform apply -auto-approve", ["-auto-approve"]],
  ["git clean -fdx", ["-fdx"]],
  ["git stash drop", ["drop"]],
  ["ls -la", []],
  ["npm install react", []],
];

describe("risky lines", () => {
  test.each(lines)("%s", (line, wanted) => {
    const notes = riskOfLine(line.split(" "));
    expect(notes.length).toBe(wanted.length);
    wanted.forEach((w, i) => expect(notes[i]).toContain(w));
  });
});
