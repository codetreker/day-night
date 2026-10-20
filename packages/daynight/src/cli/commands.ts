import type { CliCommand } from "./context.js";
import type { CommandDefinition } from "./schema.js";
import { completionDefinition } from "../commands/completion/definition.js";
import { reviewDefinition } from "../commands/review/definition.js";
import { updateDefinition } from "../commands/update/definition.js";

export type CommandRegistration = CommandDefinition & {
  load: () => Promise<CliCommand>;
};

export const commands: readonly CommandRegistration[] = [
  {
    ...reviewDefinition,
    load: async () => ({ run: (await import("../commands/review/command.js")).runReviewCommand }),
  },
  {
    ...updateDefinition,
    load: async () => ({ run: (await import("../commands/update/command.js")).runUpdateCommand }),
  },
  {
    ...completionDefinition,
    load: async () => ({ run: (await import("../commands/completion/command.js")).runCompletionCommand }),
  },
];

export const commandTree: CommandDefinition = {
  name: "daynight",
  description: "A client command toolkit for development workflows",
  commands: commands.map(({ load, ...definition }) => definition),
  options: [
    { names: ["-h", "--help"], description: "Show this help", action: "help" },
    { names: ["-v", "--version"], description: "Show the installed version", action: "version" },
  ],
  details: "Run daynight <command> --help for command usage.",
};
