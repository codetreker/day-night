import type { CommandDefinition, CommandOption } from "../../cli/schema.js";

const helpOption: CommandOption = { names: ["-h", "--help"], description: "Show this help", action: "help" };
const projectOption: CommandOption = { names: ["--project"], description: "Use this project UUID for this invocation", value: { name: "project-id", kind: "text" } };
const jsonOption: CommandOption = { names: ["--json"], description: "Print the complete API resource data as JSON" };
const titleOption: CommandOption = { names: ["--title"], description: "Task title", value: { name: "title", kind: "text" } };
const descriptionOption: CommandOption = { names: ["--description"], description: "Task description; an empty value clears it", value: { name: "description", kind: "text", allowEmpty: true } };
const dependencyOption: CommandOption = { names: ["--depends-on"], description: "Direct dependency task UUID; repeat to supply the full set", value: { name: "task-id", kind: "text" }, repeatable: true };
const statusOption: CommandOption = { names: ["--status"], description: "Task status", value: { name: "status", kind: "text", choices: ["todo", "in_progress", "done"] } };
const pullRequestOptions: readonly CommandOption[] = [
  { names: ["--pull-request-url"], description: "PR URL text; repeat for the complete list", value: { name: "text", kind: "text", allowEmpty: true }, repeatable: true },
  { names: ["--pull-request-title"], description: "PR title text; pair by position with each URL", value: { name: "text", kind: "text", allowEmpty: true }, repeatable: true },
];
const taskArgument = { name: "task-id", description: "Task UUID" };

export const taskDefinition: CommandDefinition = {
  name: "task",
  description: "Create, query, and update project tasks on the configured server",
  commands: [
    {
      name: "create",
      description: "Create a todo task with optional dependencies and PR references",
      options: [{ ...titleOption, required: true }, descriptionOption, dependencyOption, ...pullRequestOptions, projectOption, helpOption],
      details: "New tasks start in todo. Repeated --depends-on values preserve the supplied dependency set.\nPR URL and title counts must match; the nth URL pairs with the nth title. Empty values are accepted, and all text is stored as supplied.",
    },
    {
      name: "list",
      description: "List all matching tasks in the project",
      options: [statusOption, { names: ["--ready"], description: "Include only tasks ready to start" }, projectOption, jsonOption, helpOption],
      details: "Combine --status and --ready with AND. Read every page before printing the complete result.",
    },
    {
      name: "ready",
      description: "Show the first ready tasks in the project",
      options: [{ names: ["--limit"], description: "Maximum number of tasks to return, from 1 to 100 (default: 10)", value: { name: "count", kind: "text" } }, projectOption, jsonOption, helpOption],
      details: "Read one bounded page ordered by creation time, then task UUID, ascending. A task is ready when it is todo and every dependency is done.",
    },
    {
      name: "show",
      description: "Show a task by its ID",
      arguments: [taskArgument],
      options: [projectOption, jsonOption, helpOption],
    },
    {
      name: "update",
      description: "Atomically update task fields, dependencies, and PR references",
      arguments: [taskArgument],
      options: [titleOption, descriptionOption, statusOption, dependencyOption,
        { names: ["--clear-dependencies"], description: "Clear the complete dependency set" },
        ...pullRequestOptions,
        { names: ["--clear-pull-requests"], description: "Clear the complete PR reference list" },
        { names: ["--if-version"], description: "Use this expected task version without reading a newer version", value: { name: "version", kind: "text" } },
        projectOption, helpOption],
      details: "Provide at least one changed field. --depends-on replaces all dependencies; it conflicts with --clear-dependencies.\nPR URL and title counts must match; the nth URL pairs with the nth title. Pairs replace the complete list; empty values are accepted. --clear-pull-requests conflicts with either PR option. Omitted PR options preserve the current list.\nWithout --if-version, read the current version before submitting the update. Conflicts are not retried.",
    },
    {
      name: "graph",
      description: "Show the complete task graph and summary",
      options: [projectOption, jsonOption, helpOption],
    },
  ],
  options: [helpOption],
  details: "Without --project, resolve the current Git origin to its project using the repository binding.\nText options also accept --option=value; use this form for values starting with a dash.\nServer: serverUrl in ~/.daynight/config.yml\nRun daynight task <command> --help for command usage.",
};
