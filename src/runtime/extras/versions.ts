// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// `npm i react@` lists the tags (latest, next, canary) and the newest versions of the package, from the npm registry.
// One small request per package, remembered for ten minutes.

import { memo, run } from "./util.js";

type Packument = { "dist-tags"?: Record<string, string>; versions?: Record<string, { deprecated?: string }> };

const cache = memo<Packument | undefined>(10 * 60 * 1000);

const registry = () => (process.env.npm_config_registry ?? "https://registry.npmjs.org").replace(/\/+$/, "");

export const fetchPackument = (name: string): Promise<Packument | undefined> =>
  cache(name, async () => {
    // npm knows your registry, its login and your proxy, so it asks first
    const viaNpm = await run("npm", ["view", name, "dist-tags", "versions", "--json"], undefined, 4000);
    try {
      const doc = JSON.parse(viaNpm) as { "dist-tags"?: Record<string, string>; versions?: string[] | string };
      const versions = Array.isArray(doc.versions) ? doc.versions : typeof doc.versions === "string" ? [doc.versions] : [];
      if (doc["dist-tags"] != null) return { "dist-tags": doc["dist-tags"], versions: Object.fromEntries(versions.map((v) => [v, {}])) };
    } catch {
      /* no npm, or not this package: ask the registry directly */
    }
    try {
      const response = await fetch(`${registry()}/${name.replace("/", "%2f")}`, {
        // the short form npm itself uses for installs: tags and versions without the readme of every release
        headers: { accept: "application/vnd.npm.install-v1+json" },
        signal: AbortSignal.timeout(3000),
      });
      return response.ok ? ((await response.json()) as Packument) : undefined;
    } catch {
      return undefined;
    }
  });

// "@types/node@20" → ["@types/node", "20"]; undefined when no version is being typed
export const splitSpec = (token: string): [string, string] | undefined => {
  const at = token.lastIndexOf("@");
  if (at <= 0) return;
  const name = token.slice(0, at);
  if (!/^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i.test(name)) return;
  return [name, token.slice(at + 1)];
};

// semver order: numbers by value, and a release after its prereleases (19.3.0 after 19.3.0-canary.1)
// (build metadata after + does not count: 1.2.3+build.5 is 1.2.3)
const compare = (a: string, b: string) => {
  const [mainA, preA] = a.split("+")[0].split(/-(.*)/s);
  const [mainB, preB] = b.split("+")[0].split(/-(.*)/s);
  const pa = mainA.split(".").map(Number);
  const pb = mainB.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  if (!preA && !preB) return 0;
  if (!preA) return 1;
  if (!preB) return -1;
  return preA < preB ? -1 : preA > preB ? 1 : 0;
};

export const versionSuggestions = (name: string, doc: Packument): (Fig.Suggestion & { kind: "version" })[] => {
  const tags = Object.entries(doc["dist-tags"] ?? {});
  const tagged = new Map<string, string[]>();
  for (const [tag, version] of tags) tagged.set(version, [...(tagged.get(version) ?? []), tag]);
  const out: (Fig.Suggestion & { kind: "version" })[] = tags
    .sort(([a], [b]) => (a === "latest" ? -1 : b === "latest" ? 1 : a.localeCompare(b)))
    .map(([tag, version], i) => ({ name: tag, insertValue: `${name}@${tag} `, description: `${version}`, priority: 95 - i, icon: "⭐", kind: "version" }));
  // releases first, newest on top; prereleases after them (their tags are already at the top)
  const all = Object.entries(doc.versions ?? {}).sort(([a], [b]) => compare(b, a));
  const versions = [...all.filter(([v]) => !v.includes("-")).slice(0, 30), ...all.filter(([v]) => v.includes("-")).slice(0, 10)];
  versions.forEach(([version, meta], i) => {
    const notes = [tagged.get(version)?.join(", "), meta.deprecated ? "deprecated" : undefined].filter(Boolean).join(" · ");
    out.push({ name: version, insertValue: `${name}@${version} `, description: notes || undefined, priority: 80 - Math.min(i, 30), kind: "version" });
  });
  return out;
};

export const versionGenerator: Fig.Generator = {
  // the answer depends on the package before the @, so a new package (or no @ any more) asks again
  trigger: (newToken: string, oldToken: string) => splitSpec(newToken)?.[0] !== splitSpec(oldToken)?.[0],
  getQueryTerm: (token: string) => splitSpec(token)?.[1] ?? token,
  custom: async (tokens) => {
    const spec = splitSpec(tokens.at(-1) ?? "");
    if (spec == null) return [];
    const doc = await fetchPackument(spec[0]);
    return doc == null ? [] : versionSuggestions(spec[0], doc);
  },
};
