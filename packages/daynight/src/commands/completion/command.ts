import type { CliContext } from "../../cli/context.js";
import { commandTree } from "../../cli/commands.js";
import { parseCommand, renderCommandHelp } from "../../cli/schema.js";
import { completionDefinition } from "./definition.js";
import { renderBashCompletion } from "./bash.js";
import { renderZshCompletion } from "./zsh.js";

export const runCompletionCommand = async (args: readonly string[], context: CliContext): Promise<void> => {
  const commandPath = [commandTree.name, completionDefinition.name];
  if (args.length === 0) {
    context.stdout(renderCommandHelp(completionDefinition, commandPath));
    return;
  }
  const parsed = parseCommand(completionDefinition, args, commandPath);
  if (parsed.kind !== "run") {
    context.stdout(renderCommandHelp(completionDefinition, commandPath));
    return;
  }
  const render = parsed.values[0] === "bash" ? renderBashCompletion : renderZshCompletion;
  context.stdout(render(commandTree));
};
