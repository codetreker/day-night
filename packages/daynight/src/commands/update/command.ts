import { isHelp, UsageError } from "../../cli/context.js";
import type { CliContext } from "../../cli/context.js";
import type { UpdateResult } from "./updater.js";

const help = `Usage: daynight update

Update the current npm global installation to the registry's latest version.
An already-current or newer installation is kept. npm configuration and
authentication select the registry; review configuration and state are not read.
Restart any running reviewer after updating to use the new version.

Options:
  -h, --help  Show this help
`;

export type UpdateCommandDependencies = {
  update: (packageDirectory: string) => Promise<UpdateResult>;
};

const defaultDependencies: UpdateCommandDependencies = {
  update: async (packageDirectory) => (await import("./updater.js")).updateSelf({ packageDirectory }),
};

export const runUpdateCommand = async (
  args: readonly string[],
  context: CliContext,
  dependencies: UpdateCommandDependencies = defaultDependencies,
): Promise<void> => {
  if (args.length === 1 && isHelp(args[0])) {
    context.stdout(help);
    return;
  }
  if (args.length !== 0) throw new UsageError("Expected daynight update.", "daynight update --help");
  const result = await dependencies.update(context.packageDirectory);
  if (result.status === "updated") {
    context.stdout(`Updated daynight from ${result.previousVersion} to ${result.targetVersion}.\nRestart any running reviewer to use the new version.\n`);
  } else if (result.status === "current") {
    context.stdout(`daynight ${result.previousVersion} is already up to date.\n`);
  } else {
    context.stdout(`daynight ${result.previousVersion} is newer than latest ${result.targetVersion}.\n`);
  }
};
