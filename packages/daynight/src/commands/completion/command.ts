import type { CliContext } from "../../cli/context.js";
import { commandTree } from "../../cli/commands.js";
import { parseCommand, renderCommandHelp } from "../../cli/schema.js";
import { completionDefinition } from "./definition.js";
import { renderBashCompletion } from "./bash.js";
import { renderZshCompletion } from "./zsh.js";
import type { CompletionShell } from "./setup.js";

export const runCompletionCommand = async (args: readonly string[], context: CliContext): Promise<void> => {
  const commandPath = [commandTree.name, completionDefinition.name];
  const parsed = parseCommand(completionDefinition, args, commandPath);
  if (parsed.kind !== "run") {
    context.stdout(renderCommandHelp(parsed.command, parsed.path));
    return;
  }
  if (parsed.command.name === "setup") {
    const shell = parsed.options.get("--shell") as CompletionShell | undefined;
    const rcFile = parsed.options.get("--rc-file") as string | undefined;
    const { setupCompletion } = await import("./setup.js");
    const result = await setupCompletion({ shell, rcFile }, context);
    for (const file of result.files) context.stdout(`Completion configuration ${file.installed ? "installed" : "already present"}: ${file.path}\n`);
    if (result.shell === "zsh") context.stdout("Initialize compinit in the current shell if needed: autoload -Uz compinit; compinit\n");
    context.stdout(`Activate completion in the current shell:\n  source <(daynight completion ${result.shell})\n`);
    return;
  }
  const render = parsed.command.name === "bash" ? renderBashCompletion : renderZshCompletion;
  context.stdout(render(commandTree));
};
