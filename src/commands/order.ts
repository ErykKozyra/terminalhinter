// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

import chalk from "chalk";
import { Command } from "commander";

import { listOrders, resetOrder } from "../runtime/order.js";

const list = new Command("list").description("show the orders you set with Shift+Up / Shift+Down").action(() => {
  const orders = Object.entries(listOrders());
  if (orders.length === 0) {
    process.stdout.write("no custom order yet: select an entry in the list and press Shift+Up or Shift+Down\n");
    return;
  }
  for (const [context, names] of orders) process.stdout.write(`${chalk.bold(context || "(start of the line)")}  ${names.join(", ")}\n`);
});

const reset = new Command("reset")
  .description("forget the order after some words (e.g. thint order reset pnpm), or every order")
  .argument("[words...]", "the words before the list, e.g. pnpm or git checkout")
  .action((words: string[]) => {
    const removed = resetOrder(words.length > 0 ? words.join(" ") : undefined);
    process.stdout.write(removed > 0 ? chalk.green("✓") + ` forgot ${removed} order${removed === 1 ? "" : "s"}\n` : "nothing to forget\n");
  });

const cmd = new Command("order").description("your own order of the list (Shift+Up / Shift+Down on an entry)").addCommand(list).addCommand(reset);

export default cmd;
