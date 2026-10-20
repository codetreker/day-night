import type { CommandDefinition } from "../../cli/schema.js";

export const updateDefinition: CommandDefinition = {
  name: "update",
  description: "Update this npm global installation to the latest version",
  options: [{ names: ["-h", "--help"], description: "Show this help", action: "help" }],
  details: "Update the current npm global installation to the registry's latest version.\nAn already-current or newer installation is kept. npm configuration and\nauthentication select the registry; review configuration and state are not read.\nRestart any running reviewer after updating to use the new version.",
};
