import { homedir } from "node:os";
import { formatError } from "./diagnostics.js";
export { formatError } from "./diagnostics.js";
import { loadConfiguration } from "./config.js";
import { resolveRuntimePaths } from "./paths.js";
import { addRepository } from "./repositories.js";
import { formatCoordinatorEvent, runForegroundReview } from "./runtime.js";
import type { Configuration } from "./config.js";
import type { RuntimePaths } from "./paths.js";
import type { AddRepositoryInput, AddRepositoryOptions, AddRepositoryResult } from "./repositories.js";

export type CliDependencies = {
  version: string;
  homeDirectory: () => string;
  workingDirectory: () => string;
  addRepository: (input: AddRepositoryInput, paths: RuntimePaths, options: AddRepositoryOptions) => Promise<AddRepositoryResult>;
  loadConfiguration: (paths: RuntimePaths) => Promise<Configuration>;
  runReview: (configuration: Configuration, paths: RuntimePaths) => Promise<void>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

const help = `Usage: daynight --daemon-review
       daynight add-repo <remote> [--path <path>]

Commands:
  add-repo        Add a repository to configuration for the next review startup

Options:
  --daemon-review  Run foreground PR review until interrupted
  -h, --help       Show this help
  -v, --version    Show the installed version

Configuration: ~/.daynight/config.yml (current user's home directory)
Runtime state: ~/.daynight/
`;

const addRepositoryHelp = `Usage: daynight add-repo <remote> [--path <path>]

Arguments:
  <remote>        HTTPS or SSH GitHub repository address

Options:
  --path <path>   Dedicated review clone path (relative to the current directory)
  -h, --help      Show this help

Without --path, repositoryRoot (default: ~/daynights) determines the clone path.
The resolved absolute path is saved in ~/.daynight/config.yml.
Changes take effect the next time daynight --daemon-review starts.
`;

type Command =
  | { kind: "help"; text: string }
  | { kind: "version" }
  | { kind: "review" }
  | { kind: "add-repo"; input: AddRepositoryInput };

const parseCommand = (args: readonly string[]): Command => {
  if (args.length === 0) throw new Error("Choose a command.");
  if (args[0] === "add-repo") {
    const remaining = args.slice(1);
    if (remaining.length === 1 && (remaining[0] === "--help" || remaining[0] === "-h")) {
      return { kind: "help", text: addRepositoryHelp };
    }
    let remote: string | undefined;
    let repositoryPath: string | undefined;
    for (let index = 0; index < remaining.length; index++) {
      const argument = remaining[index]!;
      if (argument === "--path") {
        if (repositoryPath !== undefined) throw new Error("Specify --path only once.");
        const value = remaining[++index];
        if (value === undefined || value === "" || value.startsWith("-")) {
          throw new Error("--path requires a path value.");
        }
        repositoryPath = value;
      } else if (argument.startsWith("-")) {
        throw new Error(`Unknown add-repo option ${JSON.stringify(argument)}.`);
      } else {
        if (remote !== undefined) throw new Error("add-repo accepts exactly one remote address.");
        if (argument.trim() === "") throw new Error("add-repo requires a remote address.");
        remote = argument;
      }
    }
    if (remote === undefined) throw new Error("add-repo requires a remote address.");
    return { kind: "add-repo", input: repositoryPath === undefined ? { remote } : { remote, path: repositoryPath } };
  }
  if (args.length !== 1) throw new Error("Expected exactly one option or an add-repo command.");
  switch (args[0]) {
    case "--help": case "-h": return { kind: "help", text: help };
    case "--version": case "-v": return { kind: "version" };
    case "--daemon-review": return { kind: "review" };
    default: throw new Error(`Unknown argument ${JSON.stringify(args[0])}; review mode uses --daemon-review.`);
  }
};

export const runCli = async (
  args: readonly string[],
  dependencies: CliDependencies,
): Promise<number> => {
  const { stdout, stderr } = dependencies;
  let command: Command;
  try {
    command = parseCommand(args);
  } catch (error) {
    stderr(`${formatError(error)} Run daynight --help for usage.\n`);
    return 2;
  }
  if (command.kind === "help") {
    stdout(command.text);
    return 0;
  }
  if (command.kind === "version") {
    stdout(`${dependencies.version}\n`);
    return 0;
  }
  try {
    const homeDirectory = dependencies.homeDirectory();
    const runtimePaths = resolveRuntimePaths(homeDirectory);
    if (command.kind === "add-repo") {
      const result = await dependencies.addRepository(command.input, runtimePaths, {
        homeDirectory,
        workingDirectory: dependencies.workingDirectory(),
      });
      stdout(`Repository ${result.repository.coordinate} ${result.added ? "added" : "is already configured"}.\nPath: ${result.repository.path}\nConfiguration: ${runtimePaths.configFile}\nConfiguration takes effect the next time daynight --daemon-review starts.\n`);
      return 0;
    }
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
  workingDirectory: process.cwd,
  addRepository,
  loadConfiguration,
  runReview: (configuration, paths) => runForegroundReview(configuration, paths, {
    log: (event) => { process.stderr.write(`${formatCoordinatorEvent(event)}\n`); },
  }),
  stdout: (text) => { process.stdout.write(text); },
  stderr: (text) => { process.stderr.write(text); },
});
