import type { CommandDefinition } from "../../cli/schema.js";

export const updateDefinition: CommandDefinition = {
  name: "update",
  description: "Update this npm global installation and its installed agent skills",
  options: [{ names: ["-h", "--help"], description: "Show this help", action: "help" }],
  details: "Update the current npm global installation to the registry's latest version.\nAn already-current or newer installation is kept. npm configuration and\nauthentication select the registry; review configuration and state are not read.\nRefresh existing using-daynight skills in User and current Git worktree scopes,\neven when the package is already current or newer. Local skill edits are replaced;\nmissing skills and other projects are left untouched. No agent is launched.\nRestart any running reviewer after updating to use the new version.",
};
