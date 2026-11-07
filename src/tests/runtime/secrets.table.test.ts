// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import { looksSecret } from "../../runtime/extras/util.js";

// Example values only: none of these are real credentials.
const fake = (prefix: string, n: number) => prefix + "aB3dE5fG7hJ9kL1mN2pQ4rS6tU8vW0xY".repeat(3).slice(0, n);

// must never be stored in history or shown back
const secrets: string[] = [
  "curl -H 'Authorization: Bearer abcdefghijklmnop' https://api.example.com",
  'curl -H "Authorization: token abc123" https://api.github.com/user',
  "curl -H 'authorization: Basic dXNlcjpwYXNz' https://x",
  "http GET api.example.com 'Bearer eyJhbGciOiJIUzI1NiJ9.e30.abc'",
  "curl -u admin:s3cr3t https://example.com",
  "curl -u 'admin:s3cr3t' https://example.com",
  "git clone https://user:hunter2@github.com/org/repo.git",
  "git remote set-url origin https://bot:pass1234@gitlab.com/x/y.git",
  "psql postgres://app:VeryS3cret@db.local:5432/app",
  "redis-cli -u redis://default:pw123456@cache:6379",
  "mysql -u root -pHunter2 shop",
  "mysqldump -uroot -pSecret1 db > db.sql",
  "docker login -u me -p hunter2 registry.example.com",
  "docker login --password=hunter2 ghcr.io",
  "podman login -p x quay.io",
  "helm registry login -p hunter2 example.com",
  "sshpass -p hunter2 ssh me@host",
  "mytool --token abc123",
  "mytool --token=abc123",
  "mytool --password hunter2",
  "mytool --passwd=hunter2",
  "mytool --secret s",
  "mytool --api-key k",
  "mytool --api_key=k",
  "mytool --apikey k",
  "mytool -token abc",
  "export GITHUB_TOKEN=abc123",
  "GITHUB_TOKEN=abc123 gh pr list",
  "export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG",
  "export OPENAI_API_KEY=x",
  "export API_KEY=x",
  "export APIKEY=x",
  "export DB_PASSWORD=x",
  "export SECRET_KEY_BASE=x",
  "export PRIVATE_KEY=x",
  "export STRIPE_SECRET=x",
  "NPM_TOKEN=x npm publish",
  "export github_token=abc",
  `gh auth login --with-token <<< ${fake("ghp_", 36)}`,
  `git clone https://${fake("ghp_", 36)}@github.com/o/r`,
  `echo ${fake("gho_", 36)}`,
  `echo ${fake("github_pat_", 40)}`,
  `echo ${fake("glpat-", 20)}`,
  `curl https://api.openai.com -H x ${fake("sk-", 40)}`,
  `echo ${fake("sk-proj-", 40)}`,
  `echo ${fake("sk-ant-", 40)}`,
  `slack ${fake("xoxb-", 30)}`,
  "aws configure set aws_access_key_id AKIAIOSFODNN7EXAMPLE",
  `curl "https://maps.googleapis.com/maps/api/geocode/json?key=${fake("AIza", 35)}"`,
  `echo ${fake("", 40)}`,
  `echo "${fake("", 48)}"`,
  `curl -d token=${fake("", 32)} https://x`,
];

// ordinary commands: must be kept
const ordinary: string[] = [
  "git status",
  'git commit -m "Fix the login redirect when the session cookie expires after the user changes their password"',
  "git checkout 3f2a9c1e5b7d4e8a9c217d4e5f6a8b90c1d2e3f4",
  "git show 3f2a9c1e5b7d4e8a9c217d4e5f6a8b90c1d2e3f4",
  "docker pull nginx@sha256:0d17b565c37bcbd895e9d92315a05c1c3c9a29f762b011a10c54a66cd53c9b31",
  "kubectl delete pod web-7f9c8d6b5-x2k4p",
  "cat 550e8400-e29b-41d4-a716-446655440000.json",
  "cat 550E8400-E29B-41D4-A716-446655440000.json",
  "vim src/components/UserProfileSettingsPanel2.tsx",
  "git add src/features/checkout/components/CheckoutSummaryRow2.tsx",
  "code apps/web/src/app/api/v2/OrganizationMembershipController.ts",
  "open IMG_20240101_123456789_HDR.jpg",
  "python train.py --tokenizer=gpt2",
  "npm i @tokenizer/token",
  "git log --author=eryk",
  "pnpm add -D @types/node",
  "git update-index --skip-worktree config/settings.local.json",
  "open sketch_final_version_2024.png",
  "cd ghost-inspector-runner",
  "npm run build",
  "ssh deploy@10.0.0.12",
  "curl https://example.com/api/users?page=2",
  "export NODE_ENV=production",
  "export PASSWORD_MIN_LENGTH",
  "grep -rn password src/",
  "grep -rn 'TOKEN' .",
  "echo $GITHUB_TOKEN",
  "unset API_KEY",
  "kubectl get secret app-secrets -o yaml",
  "terraform apply -var-file=prod.tfvars",
  "yarn workspace @acme/auth-service test",
  "base64 -d file.txt",
  "openssl rand -hex 32",
  "ls -la ~/Downloads",
  "make deploy ENV=staging",
  "echo AbcdefghijklmnopqrstuvwxyzABCDEFG",
];

describe("secrets are recognized", () => {
  test.each(secrets)("%s", (command) => expect(looksSecret(command)).toBe(true));
});

describe("ordinary commands are kept", () => {
  test.each(ordinary)("%s", (command) => expect(looksSecret(command)).toBe(false));
});
