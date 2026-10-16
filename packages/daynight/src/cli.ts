import { homedir } from "node:os";
import { loadConfiguration } from "./config.js";
import { resolveRuntimePaths } from "./paths.js";
import type { Configuration } from "./config.js";
import type { RuntimePaths } from "./paths.js";

export type CliDependencies = {
  version: string;
  homeDirectory: () => string;
  loadConfiguration: (paths: RuntimePaths) => Promise<Configuration>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

const help = `Usage: daynight --deamon-review

Options:
  --deamon-review  Validate configuration for foreground PR review mode
  -h, --help       Show this help
  -v, --version    Show the installed version

Configuration: ~/.daynight/config.yml (current user's home directory)
Runtime state: ~/.daynight/
Review execution is not available in this build.
`;

export const formatError = (error: unknown): string => {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const details: string[] = [error.message];
  if (error instanceof AggregateError) {
    for (const child of error.errors) {
      details.push(formatError(child));
    }
  }
  if (error.cause !== undefined) {
    details.push(`Caused by: ${formatError(error.cause)}`);
  }
  return details.join("\n");
};

export const runCli = async (
  args: readonly string[],
  dependencies: CliDependencies,
): Promise<number> => {
  const { stdout, stderr } = dependencies;
  if (args.length === 0) {
    stderr(`Choose a command. Run daynight --help for usage.\n`);
    return 2;
  }
  if (args.length !== 1) {
    stderr("Expected exactly one option. Run daynight --help for usage.\n");
    return 2;
  }
  const argument = args[0]!;
  if (argument === "--help" || argument === "-h") {
    stdout(help);
    return 0;
  }
  if (argument === "--version" || argument === "-v") {
    stdout(`${dependencies.version}\n`);
    return 0;
  }
  if (argument !== "--deamon-review") {
    stderr(`Unknown argument ${JSON.stringify(argument)}. Run daynight --help; review mode uses --deamon-review.\n`);
    return 2;
  }
  try {
    const runtimePaths = resolveRuntimePaths(dependencies.homeDirectory());
    await dependencies.loadConfiguration(runtimePaths);
    stderr("Configuration is valid. The review coordinator is not implemented; PR review execution is not available.\n");
    return 1;
  } catch (error) {
    stderr(`${formatError(error)}\n`);
    return 1;
  }
};

export const defaultCliDependencies = (version: string): CliDependencies => ({
  version,
  homeDirectory: homedir,
  loadConfiguration,
  stdout: (text) => { process.stdout.write(text); },
  stderr: (text) => { process.stderr.write(text); },
});
