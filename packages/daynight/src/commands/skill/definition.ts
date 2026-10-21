import type { CommandDefinition } from "../../cli/schema.js";

export const skillDefinition: CommandDefinition = {
  name: "skill",
  description: "Install the Daynight project and task skill for coding agents",
  commands: [{
    name: "install",
    description: "Choose detected agents and install or replace their Daynight skill",
    options: [{ names: ["-h", "--help"], description: "Show this help", action: "help" }],
    details: "Requires interactive terminal input and stderr. Choose agents, then User or Project scope.\nReplaces the complete daynight skill directory, including local edits and obsolete files.",
  }],
  options: [{ names: ["-h", "--help"], description: "Show this help", action: "help" }],
};
