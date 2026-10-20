import { formatError } from "../platform/diagnostics.js";
import { commands } from "./commands.js";
import type { CommandRegistration } from "./commands.js";
import { isHelp, UsageError } from "./context.js";
import type { CliContext } from "./context.js";

const help = (registry: readonly CommandRegistration[]): string => `Usage: daynight <command>

Commands:
${registry.map(({ name, description }) => `  ${name.padEnd(10)}${description}`).join("\n")}

Options:
  -h, --help     Show this help
  -v, --version  Show the installed version

Run daynight <command> --help for command usage.
`;

export const runCli = async (
  args: readonly string[],
  context: CliContext,
  registry: readonly CommandRegistration[] = commands,
): Promise<number> => {
  try {
    if (args.length === 0 || args.length === 1 && isHelp(args[0])) {
      context.stdout(help(registry));
      return 0;
    }
    if (args.length === 1 && (args[0] === "--version" || args[0] === "-v")) {
      context.stdout(`${context.version}\n`);
      return 0;
    }
    const registration = registry.find(({ name }) => name === args[0]);
    if (registration === undefined) throw new UsageError(`Unknown command ${JSON.stringify(args[0])}.`);
    const command = await registration.load();
    await command.run(args.slice(1), context);
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      context.stderr(`${formatError(error)} Run ${error.helpCommand} for usage.\n`);
      return 2;
    }
    context.stderr(`${formatError(error)}\n`);
    return 1;
  }
};
