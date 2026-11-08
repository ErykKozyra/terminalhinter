// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// Lines that hold a password or a token never reach any file thint writes (commands.jsonl, history.jsonl), and never
// come back as a suggestion, also when they come from Atuin.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { rememberCommand, recentCommands, resetRecent } from "../../runtime/extras/recent.js";
import { recordExecutedCommand } from "../../runtime/runtime.js";
import { resetHistory } from "../../runtime/history.js";
import { Shell } from "../../utils/shell.js";

const secret = "Zq8vR2mK9pL4xW7nT3bY6cH1";
const secrets: string[] = [
  `curl -H "Authorization: Bearer ${secret}" https://api.example.com`,
  `curl -H 'Authorization: token ${secret}' https://api.github.com/user`,
  `curl -u admin:${secret} https://example.com`,
  `curl https://admin:${secret}@example.com/repo.git`,
  `git clone https://eryk:${secret}@github.com/acme/private.git`,
  `git remote set-url origin https://x-access-token:${secret}@github.com/acme/app.git`,
  `mysql -u root -p${secret} shop`,
  `mysqldump -uroot -p${secret} shop > dump.sql`,
  `mariadb -u app -p${secret}`,
  `docker login -u eryk -p ${secret} registry.example.com`,
  `docker login --password ${secret} ghcr.io`,
  `podman login -p ${secret} quay.io`,
  `helm registry login -u eryk --password ${secret} ghcr.io`,
  `sshpass -p ${secret} ssh root@10.0.0.2`,
  `export GITHUB_TOKEN=ghp_${secret}`,
  `export OPENAI_API_KEY=sk-${secret}`,
  `export AWS_SECRET_ACCESS_KEY=${secret}`,
  `AWS_ACCESS_KEY_ID=AKIA${secret} aws s3 ls`,
  `export DATABASE_PASSWORD=${secret}`,
  `export STRIPE_SECRET=${secret}`,
  `PGPASSWORD=${secret} psql -h db.example.com`,
  `NPM_TOKEN=${secret} npm publish`,
  `gh auth login --with-token ghp_${secret}`,
  `npm config set //registry.npmjs.org/:_authToken npm_${secret}`,
  `vercel deploy --token ${secret}`,
  `netlify deploy --auth ${secret}`,
  `heroku login --api-key ${secret}`,
  `stripe listen --api-key sk_live_${secret}`,
  `psql postgres://app:${secret}@db.example.com:5432/shop`,
  `redis-cli -a ${secret} ping`,
  `mongo mongodb://admin:${secret}@localhost:27017`,
  `wget --password=${secret} https://example.com/file`,
  `wget --http-password ${secret} https://example.com/file`,
  `openssl enc -aes-256-cbc -k ${secret} -in a -out b`,
  `kubectl create secret generic db --from-literal=password=${secret}`,
  `htpasswd -b .htpasswd admin ${secret}`,
  `echo ${secret} | docker login --password-stdin -u eryk`,
  `slack-cli --token xoxb-${secret}`,
  `curl -H "X-Api-Key: ${secret}" https://api.example.com`,
  `curl "https://api.example.com/v1?api_key=${secret}"`,
  `curl -d "client_secret=${secret}" https://auth.example.com/token`,
];

// ordinary lines that must still be remembered
const ordinary = [
  "git checkout main",
  "npm run dev",
  "docker compose up -d",
  "kubectl get pods -n shop",
  "curl https://example.com/health",
  "ssh deploy@10.0.0.2",
  "export NODE_ENV=production",
  "git log --oneline -20",
  "make test",
  "pnpm add react@19",
];

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "thint-secrets-"));
  process.env.THINT_COMMANDS_FILE = path.join(dir, "commands.jsonl");
  process.env.THINT_HISTORY_FILE = path.join(dir, "history.jsonl");
  process.env.THINT_NO_ATUIN = "1";
  resetRecent();
  resetHistory();
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.THINT_COMMANDS_FILE;
  delete process.env.THINT_HISTORY_FILE;
  delete process.env.THINT_NO_ATUIN;
});

const written = async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  return ["commands.jsonl", "history.jsonl"].map((f) => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), "utf8") : "")).join("\n");
};

test.each(secrets)("never written to disk: %s", async (line) => {
  rememberCommand(line, "/work");
  recordExecutedCommand(line, "/work", Shell.Zsh);
  expect(await written()).not.toContain(secret.slice(0, 12));
});

test.each(secrets)("never offered back: %s", async (line) => {
  resetRecent([{ command: line, cwd: "/work", time: Date.now() }]);
  const word = line.split(" ")[0];
  expect(await recentCommands("/work", word)).toEqual([]);
});

test.each(ordinary)("still remembered: %s", async (line) => {
  rememberCommand(line, "/work");
  expect((await recentCommands("/work", line.split(" ")[0])).map((r) => r.command)).toEqual([line]);
});

describe("from Atuin", () => {
  let bin: string;
  beforeEach(() => {
    delete process.env.THINT_NO_ATUIN;
    bin = path.join(dir, "bin");
    fs.mkdirSync(bin);
    const lines = [...secrets, "git checkout main"].map((l) => `2026-11-07 10:00:00\t${l}`).join("\n");
    fs.writeFileSync(path.join(dir, "atuin.txt"), lines + "\n");
    fs.writeFileSync(path.join(bin, "atuin"), `#!/bin/sh\n[ "$1" = "--version" ] && echo "atuin 18.0.0" && exit 0\ncat "${path.join(dir, "atuin.txt")}"\n`, {
      mode: 0o755,
    });
  });

  test("lines from Atuin that hold secrets are never offered", async () => {
    if (os.platform() === "win32") return;
    const before = process.env.PATH;
    process.env.PATH = `${bin}${path.delimiter}${before}`;
    try {
      const offered = [];
      for (const word of new Set([...secrets, "git checkout main"].map((l) => l.split(" ")[0])))
        offered.push(...(await recentCommands(dir, word, 50)).map((r) => r.command));
      expect(offered.filter((c) => c.includes(secret.slice(0, 12)))).toEqual([]);
      expect(offered).toContain("git checkout main");
    } finally {
      process.env.PATH = before;
    }
  });
});
