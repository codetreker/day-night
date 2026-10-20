import { isHelp, UsageError } from "../../cli/context.js";
import type { CliContext } from "../../cli/context.js";
import type { ReviewConfiguration } from "./config.js";
import { resolveReviewPaths } from "./paths.js";
import type { ReviewPaths } from "./paths.js";
import type { AddRepositoryInput, AddRepositoryOptions, AddRepositoryResult } from "./repositories.js";

const help = `Usage: daynight review <command>

Commands:
  run             Run foreground PR review until interrupted
  list, ls        List tracked ongoing PRs and recorded review status
  add-repo        Add a repository to configuration for the next review startup

Options:
  -h, --help      Show this help

Configuration: ~/.daynight/config.yml (current user's home directory)
Runtime state: ~/.daynight/
Run daynight review <command> --help for command usage.
`;

const runHelp = `Usage: daynight review run

Run foreground PR review using ~/.daynight/config.yml until interrupted.

Options:
  -h, --help  Show this help
`;

const listHelp = `Usage: daynight review list
       daynight review ls

Print a local persisted snapshot of configured repositories and tracked open PRs.
Includes Draft PRs, saved review status, attempts, retry deadlines and errors.
Last observed identifies the latest successful repository observation.
Running is a recorded review state and does not establish process liveness.

Options:
  -h, --help  Show this help
`;

const addRepositoryHelp = `Usage: daynight review add-repo <remote> [--path <path>]

Arguments:
  <remote>        HTTPS or SSH GitHub repository address

Options:
  --path <path>   Dedicated review clone path (relative to the current directory)
  -h, --help      Show this help

Without --path, repositoryRoot (default: ~/daynights) determines the clone path.
The resolved absolute path is saved in ~/.daynight/config.yml.
Changes take effect the next time daynight review run starts.
`;

export type ReviewCommandDependencies = {
  addRepository: (input: AddRepositoryInput, paths: ReviewPaths, options: AddRepositoryOptions) => Promise<AddRepositoryResult>;
  listReviews: (paths: ReviewPaths) => Promise<string>;
  loadConfiguration: (paths: ReviewPaths) => Promise<ReviewConfiguration>;
  runReview: (configuration: ReviewConfiguration, paths: ReviewPaths) => Promise<void>;
};

const defaultDependencies = (context: CliContext): ReviewCommandDependencies => ({
  addRepository: async (...args) => (await import("./repositories.js")).addRepository(...args),
  listReviews: async (paths) => (await import("./listing.js")).listReviews(paths),
  loadConfiguration: async (paths) => (await import("./config.js")).loadConfiguration(paths),
  runReview: async (configuration, paths) => {
    const { formatCoordinatorEvent, runForegroundReview } = await import("./runtime.js");
    await runForegroundReview(configuration, paths, {
      log: (event) => { context.stderr(`${formatCoordinatorEvent(event)}\n`); },
    });
  },
});

type ReviewOperation =
  | { kind: "help"; text: string }
  | { kind: "run" }
  | { kind: "list" }
  | { kind: "add-repo"; input: AddRepositoryInput };

const usageError = (message: string): UsageError => new UsageError(message, "daynight review --help");

const parseAddRepository = (args: readonly string[]): AddRepositoryInput => {
  let remote: string | undefined;
  let repositoryPath: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (argument === "--path") {
      if (repositoryPath !== undefined) throw usageError("Specify --path only once.");
      const value = args[++index];
      if (value === undefined || value === "" || value.startsWith("-")) throw usageError("--path requires a path value.");
      repositoryPath = value;
    } else if (argument.startsWith("-")) {
      throw usageError(`Unknown add-repo option ${JSON.stringify(argument)}.`);
    } else {
      if (remote !== undefined) throw usageError("add-repo accepts exactly one remote address.");
      if (argument.trim() === "") throw usageError("add-repo requires a remote address.");
      remote = argument;
    }
  }
  if (remote === undefined) throw usageError("add-repo requires a remote address.");
  return repositoryPath === undefined ? { remote } : { remote, path: repositoryPath };
};

const parseOperation = (args: readonly string[]): ReviewOperation => {
  if (args.length === 0 || args.length === 1 && isHelp(args[0])) return { kind: "help", text: help };
  const remaining = args.slice(1);
  if (args[0] === "add-repo") {
    if (remaining.length === 1 && isHelp(remaining[0])) return { kind: "help", text: addRepositoryHelp };
    return { kind: "add-repo", input: parseAddRepository(remaining) };
  }
  if (args[0] === "run" || args[0] === "list" || args[0] === "ls") {
    if (remaining.length === 1 && isHelp(remaining[0])) return { kind: "help", text: args[0] === "run" ? runHelp : listHelp };
    if (remaining.length === 0) return { kind: args[0] === "run" ? "run" : "list" };
  }
  throw usageError("Expected daynight review run, list, ls, or add-repo.");
};

export const runReviewCommand = async (
  args: readonly string[],
  context: CliContext,
  dependencies: ReviewCommandDependencies = defaultDependencies(context),
): Promise<void> => {
  const operation = parseOperation(args);
  if (operation.kind === "help") {
    context.stdout(operation.text);
    return;
  }
  const homeDirectory = context.homeDirectory();
  const paths = resolveReviewPaths(homeDirectory);
  if (operation.kind === "list") {
    context.stdout(await dependencies.listReviews(paths));
    return;
  }
  if (operation.kind === "add-repo") {
    const result = await dependencies.addRepository(operation.input, paths, {
      homeDirectory,
      workingDirectory: context.workingDirectory(),
    });
    context.stdout(`Repository ${result.repository.coordinate} ${result.added ? "added" : "is already configured"}.\nPath: ${result.repository.path}\nConfiguration: ${paths.configFile}\nConfiguration takes effect the next time daynight review run starts.\n`);
    return;
  }
  const configuration = await dependencies.loadConfiguration(paths);
  await dependencies.runReview(configuration, paths);
};
