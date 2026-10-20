import { parseCommand, renderCommandHelp } from "../../cli/schema.js";
import type { CliContext } from "../../cli/context.js";
import { updateDefinition } from "./definition.js";
import type { UpdateResult } from "./updater.js";

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
  const operation = parseCommand(updateDefinition, args, ["daynight", "update"]);
  if (operation.kind !== "run") {
    context.stdout(renderCommandHelp(operation.command, operation.path));
    return;
  }
  const result = await dependencies.update(context.packageDirectory);
  if (result.status === "updated") {
    context.stdout(`Updated daynight from ${result.previousVersion} to ${result.targetVersion}.\nRestart any running reviewer to use the new version.\n`);
  } else if (result.status === "current") {
    context.stdout(`daynight ${result.previousVersion} is already up to date.\n`);
  } else {
    context.stdout(`daynight ${result.previousVersion} is newer than latest ${result.targetVersion}.\n`);
  }
};
