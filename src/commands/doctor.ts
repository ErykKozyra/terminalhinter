// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Command } from "commander";
import { render } from "../ui/ui-doctor.js";

const action = async () => {
  await render();
};

const cmd = new Command("doctor");
cmd.description(`checks the health of this terminalhinter installation`);
cmd.action(action);

export default cmd;
