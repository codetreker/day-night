import { homedir } from "node:os";
import { formatError } from "./diagnostics.js";
export { formatError } from "./diagnostics.js";
import { loadConfiguration } from "./config.js";
import { resolveRuntimePaths } from "./paths.js";
import { formatCoordinatorEvent, runForegroundReview } from "./runtime.js";
import type { Configuration } from "./config.js";
import type { RuntimePaths } from "./paths.js";

export type CliDependencies = {
  version: string;
  homeDirectory: () => string;
  loadConfiguration: (paths: RuntimePaths) => Promise<Configuration>;
  runReview: (configuration: Configuration, paths: RuntimePaths) => Promise<void>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

const help = `Usage: daynight --deamon-review

Options:
  --deamon-review  Run foreground PR review until interrupted
  -h, --help       Show this help
  -v, --version    Show the installed version

Configuration: ~/.daynight/config.yml (current user's home directory)
Runtime state: ~/.daynight/
`;


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
    const configuration = await dependencies.loadConfiguration(runtimePaths);
    await dependencies.runReview(configuration, runtimePaths);
    return 0;
  } catch (error) {
    stderr(`${formatError(error)}\n`);
    return 1;
  }
};

export const defaultCliDependencies = (version: string): CliDependencies => ({
  version,
  homeDirectory: homedir,
  loadConfiguration,
  runReview: (configuration, paths) => runForegroundReview(configuration, paths, {
    log: (event) => { process.stderr.write(`${formatCoordinatorEvent(event)}\n`); },
  }),
  stdout: (text) => { process.stdout.write(text); },
  stderr: (text) => { process.stderr.write(text); },
});
