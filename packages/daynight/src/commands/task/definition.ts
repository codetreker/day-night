import type { CommandDefinition, CommandOption } from "../../cli/schema.js";

const helpOption: CommandOption = { names: ["-h", "--help"], description: "Show this help", action: "help" };
const projectOption: CommandOption = { names: ["--project"], description: "Use this project UUID for this invocation", value: { name: "project-id", kind: "text" } };
const jsonOption: CommandOption = { names: ["--json"], description: "Print the complete API resource data as JSON" };
const listJsonOption: CommandOption = { names: ["--json"], description: "Print task fields except description as JSON" };
const titleOption: CommandOption = { names: ["--title"], description: "Task title", value: { name: "title", kind: "text" } };
const descriptionOption: CommandOption = { names: ["--description"], description: "Task description; an empty value clears it", value: { name: "description", kind: "text", allowEmpty: true } };
const dependencyOption: CommandOption = { names: ["--depends-on"], description: "Direct dependency task UUID; repeat to supply the full set", value: { name: "task-id", kind: "text" }, repeatable: true };
const statusOption: CommandOption = { names: ["--status"], description: "Task status", value: { name: "status", kind: "text", choices: ["proposed", "todo", "in_progress", "done"] } };
const allowAgentsOption: CommandOption = { names: ["--allow-agents"], description: "Automatic-execution permission", value: { name: "true|false", kind: "text", choices: ["true", "false"] } };
const versionOption: CommandOption = { names: ["--if-version"], description: "Use this expected task version without reading a newer version", value: { name: "version", kind: "text" } };
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
      description: "Create a proposed task with optional dependencies and PR references",
      options: [{ ...titleOption, required: true }, descriptionOption, dependencyOption, ...pullRequestOptions, projectOption, helpOption],
      details: "New tasks start in proposed with automatic execution disabled and require approval before they can be claimed. Repeated --depends-on values preserve the supplied dependency set.\nPR URL and title counts must match; the nth URL pairs with the nth title. Empty values are accepted, and all text is stored as supplied.",
    },
    {
      name: "list",
      description: "List unfinished tasks, with in-progress and ready tasks first",
      options: [{ names: ["--all"], description: "Include completed tasks; conflicts with --status" }, statusOption, { names: ["--ready"], description: "Include only tasks ready to start" }, allowAgentsOption, projectOption, listJsonOption, helpOption],
      details: "By default, exclude done tasks. Use --all for every status or --status for a specific status.\nCombine --ready and --allow-agents with the selected statuses using AND. Read every page before printing.\nOrder in_progress first, then ready todo, blocked todo, proposed, and done tasks; preserve server order within each group.\nText lists omit description, version, and timestamps. --json omits description and preserves every other task field with the same filtering and ordering.",
    },
    {
      name: "ready",
      description: "Show the first ready tasks in the project",
      options: [{ names: ["--limit"], description: "Maximum number of tasks to return, from 1 to 100 (default: 10)", value: { name: "count", kind: "text" } }, allowAgentsOption, projectOption, jsonOption, helpOption],
      details: "Read one bounded page ordered by creation time, then task UUID, ascending. A task is ready when it is todo and every dependency is done. --allow-agents filters before the page limit and does not change readiness.",
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
      options: [titleOption, descriptionOption, allowAgentsOption, dependencyOption,
        { names: ["--clear-dependencies"], description: "Clear the complete dependency set" },
        ...pullRequestOptions,
        { names: ["--clear-pull-requests"], description: "Clear the complete PR reference list" },
        versionOption,
        projectOption, helpOption],
      details: "Provide at least one changed field. --allow-agents changes the automatic-execution permission independently of approval; actual changes are locked during in_progress. Use daynight task approve, unapprove, claim, or complete to change status.\n--depends-on replaces all dependencies; it conflicts with --clear-dependencies.\nPR URL and title counts must match; the nth URL pairs with the nth title. Pairs replace the complete list; empty values are accepted. --clear-pull-requests conflicts with either PR option. Omitted PR options preserve the current list.\nWithout --if-version, read the current version before submitting the update. Conflicts are not retried.",
    },
    ...([
      { name: "approve", description: "Approve a proposed task, moving it to todo", rule: "Unfinished prerequisites are allowed." },
      { name: "unapprove", description: "Withdraw approval from a todo task, moving it to proposed", rule: "Only todo tasks can return to proposed; unfinished prerequisites are allowed." },
      { name: "claim", description: "Claim an approved todo task, moving it to in_progress", rule: "Every direct prerequisite must be done." },
      { name: "complete", description: "Complete an in_progress task, moving it to done", rule: "Every direct prerequisite must be done." },
    ] as const).map(({ name, description, rule }): CommandDefinition => ({
      name,
      description,
      arguments: [taskArgument],
      options: [versionOption, projectOption, helpOption],
      details: `${rule}\nWithout --if-version, read the current version immediately before submitting the action.\nWith --if-version, submit exactly that version without reading the task. Conflicts and mutations are not retried.`,
    })),
    {
      name: "graph",
      description: "Show the complete task graph and summary",
      options: [projectOption, jsonOption, helpOption],
    },
    {
      name: "attachment",
      description: "Manage files attached to a task",
      commands: [
        {
          name: "put",
          description: "Upload one local regular file, replacing the same attachment path",
          arguments: [taskArgument, { name: "file", description: "Local regular file to upload" }],
          options: [{ names: ["--path"], description: "Attachment relative path (default: source basename)", value: { name: "relative-path", kind: "text" } }, projectOption, helpOption],
          allowOptionsTerminator: true,
          details: "Infer the content type from the attachment path. Unknown extensions use application/octet-stream.\nUse -- before a file name starting with a dash, or --path=value for a dash-prefixed target path. Writes are not retried; an interrupted operation may already have taken effect.",
        },
        {
          name: "list",
          description: "List every attachment and its metadata",
          arguments: [taskArgument],
          options: [{ names: ["--tree"], description: "Display attachment paths as a directory tree" }, projectOption, jsonOption, helpOption],
          details: "Read every page before printing. --tree and --json are mutually exclusive.",
        },
        {
          name: "read",
          description: "Write the attachment's original bytes to stdout",
          arguments: [taskArgument, { name: "relative-path", description: "Complete attachment relative path" }],
          options: [projectOption, helpOption],
          allowOptionsTerminator: true,
          details: "Output contains only the original bytes, with no labels or extra newline. Diagnostics go to stderr.\nA failed read may leave incomplete content on stdout. Use -- before a path starting with a dash.",
        },
        {
          name: "remove",
          description: "Remove one attachment by its complete relative path",
          arguments: [taskArgument, { name: "relative-path", description: "Complete attachment relative path" }],
          options: [projectOption, helpOption],
          allowOptionsTerminator: true,
          details: "Use -- before a path starting with a dash. Deletes are not retried; an interrupted operation may already have taken effect.",
        },
      ],
      options: [helpOption],
      details: "Paths are case-sensitive, use / separators, and preserve Unicode spelling.\nWithout --project, resolve the current Git origin to its project.\nRun daynight task attachment <command> --help for command usage.",
    },
  ],
  options: [helpOption],
  details: "Without --project, resolve the current Git origin to its project using the repository binding.\nText options also accept --option=value; use this form for values starting with a dash.\nServer: serverUrl in ~/.daynight/config.yml\nRun daynight task <command> --help for command usage.",
};
