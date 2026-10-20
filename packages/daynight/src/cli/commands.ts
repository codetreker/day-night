import type { CliCommand } from "./context.js";

export type CommandRegistration = {
  name: string;
  description: string;
  load: () => Promise<CliCommand>;
};

export const commands: readonly CommandRegistration[] = [
  {
    name: "review",
    description: "Review GitHub pull requests and manage local review configuration",
    load: async () => ({ run: (await import("../commands/review/command.js")).runReviewCommand }),
  },
  {
    name: "update",
    description: "Update this npm global installation to the latest version",
    load: async () => ({ run: (await import("../commands/update/command.js")).runUpdateCommand }),
  },
];
