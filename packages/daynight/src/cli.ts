import { homedir } from "node:os";
import { formatError } from "./diagnostics.js";
export { formatError } from "./diagnostics.js";
import { loadConfiguration } from "./config.js";
import { resolveRuntimePaths } from "./paths.js";
import { addRepository } from "./repositories.js";
import { updateSelf } from "./update.js";
import type { Configuration } from "./config.js";
import type { RuntimePaths } from "./paths.js";
import type { AddRepositoryInput, AddRepositoryOptions, AddRepositoryResult } from "./repositories.js";
import type { UpdateResult } from "./update.js";

export type CliDependencies = {
  version: string;
  update: () => Promise<UpdateResult>;
  homeDirectory: () => string;
  workingDirectory: () => string;
  addRepository: (input: AddRepositoryInput, paths: RuntimePaths, options: AddRepositoryOptions) => Promise<AddRepositoryResult>;
  listReviews: (paths: RuntimePaths) => Promise<string>;
  loadConfiguration: (paths: RuntimePaths) => Promise<Configuration>;
  runReview: (configuration: Configuration, paths: RuntimePaths) => Promise<void>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

const help = `Usage: daynight --daemon-review
       daynight add-repo <remote> [--path <path>]
       daynight review list|ls
       daynight update

Commands:
  add-repo        Add a repository to configuration for the next review startup
  review list|ls  List tracked ongoing PRs and recorded review status
  update          Update this npm global installation to the latest version

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

const reviewHelp = `Usage: daynight review list
       daynight review ls

Print a local persisted snapshot of configured repositories and tracked open PRs.
Includes Draft PRs, saved review status, attempts, retry deadlines and errors.
Last observed identifies the latest successful repository observation.
Running is a recorded review state and does not establish process liveness.

Options:
  -h, --help      Show this help
`;

const updateHelp = `Usage: daynight update

Update the current npm global installation to the registry's latest version.
An already-current or newer installation is kept. npm configuration and
authentication select the registry; Daynight configuration and review state are not read.
Restart any running reviewer after updating to use the new version.

Options:
  -h, --help      Show this help
`;

type Command =
  | { kind: "help"; text: string }
  | { kind: "version" }
  | { kind: "review" }
  | { kind: "review-list" }
  | { kind: "update" }
  | { kind: "add-repo"; input: AddRepositoryInput };

const parseCommand = (args: readonly string[]): Command => {
  if (args.length === 0) throw new Error("Choose a command.");
  if (args[0] === "update") {
    if (args.length === 1) return { kind: "update" };
    if (args.length === 2 && (args[1] === "--help" || args[1] === "-h")) return { kind: "help", text: updateHelp };
    throw new Error("Expected daynight update. Run daynight update --help for usage.");
  }
  if (args[0] === "review") {
    const remaining = args.slice(1);
    const isHelp = (value: string | undefined): boolean => value === "--help" || value === "-h";
    if (remaining.length === 1 && isHelp(remaining[0])) return { kind: "help", text: reviewHelp };
    if (remaining[0] === "list" || remaining[0] === "ls") {
      if (remaining.length === 1) return { kind: "review-list" };
      if (remaining.length === 2 && isHelp(remaining[1])) return { kind: "help", text: reviewHelp };
    }
    throw new Error("Expected daynight review list or daynight review ls.");
  }
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
  if (args.length !== 1) throw new Error("Expected a single command. Run daynight --help for supported commands.");
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
    if (command.kind === "update") {
      const result = await dependencies.update();
      if (result.status === "updated") {
        stdout(`Updated daynight from ${result.previousVersion} to ${result.targetVersion}.\nRestart any running reviewer to use the new version.\n`);
      } else if (result.status === "current") {
        stdout(`daynight ${result.previousVersion} is already up to date.\n`);
      } else {
        stdout(`daynight ${result.previousVersion} is newer than latest ${result.targetVersion}.\n`);
      }
      return 0;
    }
    const homeDirectory = dependencies.homeDirectory();
    const runtimePaths = resolveRuntimePaths(homeDirectory);
    if (command.kind === "review-list") {
      stdout(await dependencies.listReviews(runtimePaths));
      return 0;
    }
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
  update: updateSelf,
  homeDirectory: homedir,
  workingDirectory: process.cwd,
  addRepository,
  listReviews: async (paths) => {
    const { listReviews } = await import("./review-list.js");
    return listReviews(paths);
  },
  loadConfiguration,
  runReview: async (configuration, paths) => {
    const { formatCoordinatorEvent, runForegroundReview } = await import("./runtime.js");
    await runForegroundReview(configuration, paths, {
      log: (event) => { process.stderr.write(`${formatCoordinatorEvent(event)}\n`); },
    });
  },
  stdout: (text) => { process.stdout.write(text); },
  stderr: (text) => { process.stderr.write(text); },
});
