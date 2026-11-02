// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// Your own order of the list. Shift+Up / Shift+Down (or Alt+Up / Alt+Down) on a selected entry moves it, and the
// order is kept per spot in a command line: what you arrange after `pnpm` applies every time you type `pnpm`.
// Entries you placed come first, in your order, among the ones that match what you typed.

import fs from "node:fs";
import path from "node:path";

import { allResourcesPath } from "../utils/constants.js";
import log from "../utils/log.js";

export const orderPath = () => process.env.THINT_ORDER_FILE ?? path.join(allResourcesPath, "order.json");

let orders: Record<string, string[]> | undefined;

const load = (): Record<string, string[]> => {
  if (orders != null) return orders;
  try {
    const parsed = JSON.parse(fs.readFileSync(orderPath(), "utf8")) as unknown;
    orders = parsed != null && typeof parsed === "object" ? (parsed as Record<string, string[]>) : {};
  } catch {
    orders = {};
  }
  return orders;
};

const save = () => {
  try {
    fs.mkdirSync(path.dirname(orderPath()), { recursive: true });
    fs.writeFileSync(orderPath(), JSON.stringify(orders ?? {}, null, 2) + "\n");
  } catch (e) {
    log.debug({ msg: "could not save the list order", e: (e as Error).message });
  }
};

// position you gave this entry after these words, or undefined when you never placed it
export const orderRank = (context: string, name: string): number | undefined => {
  const index = load()[context]?.indexOf(name) ?? -1;
  return index === -1 ? undefined : index;
};

// `names` is the list as it should look from the top; entries not in it keep their usual place after them
export const setOrder = (context: string, names: string[]) => {
  const all = load();
  const kept = (all[context] ?? []).filter((n) => !names.includes(n));
  all[context] = [...names, ...kept];
  save();
};

export const hasCustomOrder = (): boolean => Object.keys(load()).length > 0;

export const listOrders = (): Record<string, string[]> => ({ ...load() });

// forgets the order after these words, or every order when no words are given; returns how many were removed
export const resetOrder = (context?: string): number => {
  const all = load();
  const keys = context == null ? Object.keys(all) : Object.keys(all).filter((k) => k === context);
  for (const k of keys) delete all[k];
  save();
  return keys.length;
};

// for tests
export const reloadOrder = () => {
  orders = undefined;
};
