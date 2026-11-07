// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// Programs listening on a port, with the folder they run in: `kill ` lists ":3000 next dev · ~/Dev/shop" and
// `lsof -i :` lists the ports. macOS asks lsof, Linux asks ss and /proc.

import fs from "node:fs";

import { memo, run, tildify } from "./util.js";

export type Listener = { port: number; pid: number; command: string; cwd?: string };

const cached = memo<Listener[]>(2000);

const parseLsof = (out: string): { port: number; pid: number; command: string }[] => {
  const found: { port: number; pid: number; command: string }[] = [];
  let pid = 0;
  let command = "";
  for (const line of out.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("c")) command = line.slice(1);
    else if (line.startsWith("n")) {
      const port = Number(line.match(/:(\d+)$/)?.[1]);
      if (pid && port) found.push({ port, pid, command });
    }
  }
  return found;
};

const parseSs = (out: string): { port: number; pid: number; command: string }[] => {
  const found: { port: number; pid: number; command: string }[] = [];
  for (const line of out.split("\n")) {
    const port = Number(line.match(/\S+:(\d+)\s+\S+:\S+/)?.[1]);
    const user = line.match(/users:\(\("([^"]+)",pid=(\d+)/);
    if (port && user) found.push({ port, pid: Number(user[2]), command: user[1] });
  }
  return found;
};

const fullCommand = async (pid: number): Promise<string | undefined> => {
  try {
    const raw = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");
    if (raw) return raw.split("\0").filter(Boolean).join(" ");
  } catch {
    /* not Linux, ask ps */
  }
  return (await run("ps", ["-o", "command=", "-p", String(pid)], undefined, 1000)).trim() || undefined;
};

const processCwd = async (pid: number): Promise<string | undefined> => {
  try {
    return fs.readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    /* not Linux */
  }
  const out = await run("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], undefined, 1000);
  return out
    .split("\n")
    .find((l) => l.startsWith("n"))
    ?.slice(1);
};

// `node /x/node_modules/.bin/next dev` reads better as "next dev"
const shortCommand = (full: string | undefined, fallback: string): string => {
  if (!full) return fallback;
  const words = full.split(/\s+/);
  const scriptAt = words.findIndex((w, i) => i > 0 && /\.bin\/|\/(next|vite|nuxt|astro|remix|webpack|tsx|ts-node|nodemon)(\.js)?$/.test(w));
  const picked = scriptAt > 0 ? words.slice(scriptAt) : words;
  picked[0] = picked[0].split("/").at(-1) ?? picked[0];
  return picked.slice(0, 4).join(" ");
};

export const listeningProcesses = (): Promise<Listener[]> =>
  cached("listeners", async () => {
    // Linux has ss almost everywhere; lsof is the fallback there and the tool on macOS
    let raw = process.platform === "linux" ? parseSs(await run("ss", ["-ltnpH"], undefined, 1500)) : [];
    if (raw.length === 0) raw = parseLsof(await run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpcn"], undefined, 2000));
    const seen = new Set<string>();
    const unique = raw.filter((l) => !seen.has(`${l.pid}:${l.port}`) && seen.add(`${l.pid}:${l.port}`)).sort((a, b) => a.port - b.port);
    return Promise.all(
      unique.slice(0, 40).map(async (l) => {
        const [full, cwd] = await Promise.all([fullCommand(l.pid), processCwd(l.pid)]);
        return { port: l.port, pid: l.pid, command: shortCommand(full, l.command), cwd };
      }),
    );
  });

const describe = (l: Listener) => `:${l.port} ${l.command}${l.cwd && l.cwd !== "/" ? ` · ${tildify(l.cwd)}` : ""}`;

// `kill` and `kill -9`: the processes that hold a port come first, as their PID
export const pidGenerator: Fig.Generator = {
  custom: async () => {
    const listeners = await listeningProcesses();
    const byPid = new Map<number, Listener[]>();
    for (const l of listeners) byPid.set(l.pid, [...(byPid.get(l.pid) ?? []), l]);
    return [...byPid.entries()].map(([pid, ls]) => ({
      name: String(pid),
      description: ls.map(describe).join(", "),
      priority: 85,
      icon: "⭐",
    }));
  },
};

// `lsof -i :` and `npx kill-port `: the ports in use
export const portGenerator = (prefix: string): Fig.Generator => ({
  getQueryTerm: (token: string) => token.replace(/^.*:/, ""),
  custom: async () =>
    (await listeningProcesses()).map((l) => ({
      name: String(l.port),
      insertValue: `${prefix}${l.port} `,
      description: describe(l).replace(/^:\d+ /, ""),
      priority: 85,
      icon: "⭐",
    })),
});
