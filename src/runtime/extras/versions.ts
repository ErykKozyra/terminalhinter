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

const compare = (a: string, b: string) => {
  const pa = a.split(/[.-]/).map((p) => (/^\d+$/.test(p) ? Number(p) : p));
  const pb = b.split(/[.-]/).map((p) => (/^\d+$/.test(p) ? Number(p) : p));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? -1;
    const y = pb[i] ?? -1;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x - y;
    return String(x) < String(y) ? -1 : 1;
  }
  return 0;
};

export const versionSuggestions = (name: string, doc: Packument): (Fig.Suggestion & { kind: "version" })[] => {
  const tags = Object.entries(doc["dist-tags"] ?? {});
  const tagged = new Map<string, string[]>();
  for (const [tag, version] of tags) tagged.set(version, [...(tagged.get(version) ?? []), tag]);
  const out: (Fig.Suggestion & { kind: "version" })[] = tags
    .sort(([a], [b]) => (a === "latest" ? -1 : b === "latest" ? 1 : a.localeCompare(b)))
    .map(([tag, version], i) => ({ name: tag, insertValue: `${name}@${tag} `, description: `${version}`, priority: 95 - i, icon: "⭐", kind: "version" }));
  const versions = Object.entries(doc.versions ?? {})
    .sort(([a], [b]) => compare(b, a))
    .slice(0, 40);
  versions.forEach(([version, meta], i) => {
    const notes = [tagged.get(version)?.join(", "), meta.deprecated ? "deprecated" : undefined].filter(Boolean).join(" · ");
    out.push({ name: version, insertValue: `${name}@${version} `, description: notes || undefined, priority: 80 - Math.min(i, 30), kind: "version" });
  });
  return out;
};

export const versionGenerator: Fig.Generator = {
  getQueryTerm: (token: string) => splitSpec(token)?.[1] ?? token,
  custom: async (tokens) => {
    const spec = splitSpec(tokens.at(-1) ?? "");
    if (spec == null) return [];
    const doc = await fetchPackument(spec[0]);
    return doc == null ? [] : versionSuggestions(spec[0], doc);
  },
};
