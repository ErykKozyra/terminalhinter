// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Command } from "commander";
import list from "./list.js";
import create from "./new.js";
import check from "./check.js";

const cmd = new Command("specs");
cmd.description(`manage specs, including your own suggestions in YAML`);
cmd.addCommand(list);
cmd.addCommand(create);
cmd.addCommand(check);

export default cmd;
