import { UsageError } from "../../cli/context.js";
import type { CliContext } from "../../cli/context.js";
import { parseCommand, renderCommandHelp } from "../../cli/schema.js";
import { configure } from "../../config/setup.js";
import { setupDefinition } from "./definition.js";

export const runSetupCommand = async (args: readonly string[], context: CliContext): Promise<void> => {
  const command = parseCommand(setupDefinition, args, ["daynight", "setup"], "daynight setup --help");
  if (command.kind !== "run") { context.stdout(renderCommandHelp(command.command, command.path)); return; }
  const serverUrl = command.options.get("--server-url") as string | undefined;
  const remote = command.options.get("--review-repo") as string | undefined;
  const repositoryPath = command.options.get("--review-path") as string | undefined;
  if (repositoryPath !== undefined && remote === undefined) throw new UsageError("--review-path requires --review-repo.", "daynight setup --help");
  await configure(context, serverUrl === undefined && remote === undefined ? undefined : {
    ...(serverUrl === undefined ? {} : { serverUrl }),
    ...(remote === undefined ? {} : { reviewRepository: { remote, ...(repositoryPath === undefined ? {} : { path: repositoryPath }) } }),
  });
};
