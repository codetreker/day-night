import type { CreateTaskInput, Project, TaskFilters, TaskStatus, UpdateTaskInput } from "../../api/types.js";
import { UsageError } from "../../cli/context.js";
import type { CliContext } from "../../cli/context.js";
import { parseCommand, renderCommandHelp } from "../../cli/schema.js";
import { isNonemptyText, isText } from "../../platform/text.js";
import type { resolveProject } from "../../repository/index.js";
import type { runServerCommand } from "../server/runtime.js";
import { taskDefinition } from "./definition.js";

export type TaskCommandDependencies = {
  runServerCommand: typeof runServerCommand;
  resolveProject: typeof resolveProject;
};

const defaultDependencies: TaskCommandDependencies = {
  runServerCommand: async (...args) => (await import("../server/runtime.js")).runServerCommand(...args),
  resolveProject: async (...args) => (await import("../../repository/index.js")).resolveProject(...args),
};

export const runTaskCommand = async (
  args: readonly string[],
  context: CliContext,
  dependencies: TaskCommandDependencies = defaultDependencies,
): Promise<void> => {
  const command = parseCommand(taskDefinition, args, ["daynight", "task"], "daynight task --help");
  if (command.kind !== "run") {
    context.stdout(renderCommandHelp(command.command, command.path));
    return;
  }
  if (command.path[2] === "attachment") {
    const { runTaskAttachmentCommand } = await import("./attachment.js");
    await runTaskAttachmentCommand(command, context, dependencies);
    return;
  }
  const help = `${command.path.join(" ")} --help`;
  const title = command.options.get("--title") as string | undefined;
  const description = command.options.get("--description") as string | undefined;
  const status = command.options.get("--status") as TaskStatus | undefined;
  const dependsOn = command.options.get("--depends-on") as readonly string[] | undefined;
  const clearDependencies = command.options.has("--clear-dependencies");
  const pullRequestUrls = command.options.get("--pull-request-url") as readonly string[] | undefined;
  const pullRequestTitles = command.options.get("--pull-request-title") as readonly string[] | undefined;
  const clearPullRequests = command.options.has("--clear-pull-requests");
  if (clearPullRequests && (pullRequestUrls !== undefined || pullRequestTitles !== undefined)) throw new UsageError("--clear-pull-requests conflicts with --pull-request-url and --pull-request-title.", help);
  if (pullRequestUrls?.length !== pullRequestTitles?.length) throw new UsageError("Provide the same number of --pull-request-url and --pull-request-title values.", help);
  const properties = clearPullRequests ? { pullRequests: [] } : pullRequestUrls === undefined ? undefined : { pullRequests: pullRequestUrls.map((url, index) => ({ url, title: pullRequestTitles![index]! })) };
  const limitArgument = command.options.get("--limit") as string | undefined;
  const readyLimit = limitArgument === undefined ? 10 : Number(limitArgument);
  if (limitArgument !== undefined && (!/^[0-9]+$/.test(limitArgument) || !Number.isInteger(readyLimit) || readyLimit < 1 || readyLimit > 100)) throw new UsageError("Ready task limit must be a decimal integer from 1 to 100.", help);
  if (title !== undefined && !isNonemptyText(title)) throw new UsageError("Task title must be nonempty UTF-8 text without NUL characters.", help);
  if (description !== undefined && !isText(description)) throw new UsageError("Task description must be UTF-8 text without NUL characters.", help);
  if (status !== undefined && !["todo", "in_progress", "done"].includes(status)) throw new UsageError("Task status must be todo, in_progress, or done.", help);
  if (dependsOn !== undefined && clearDependencies) throw new UsageError("Specify --depends-on or --clear-dependencies, not both.", help);
  const changes: Omit<UpdateTaskInput, "version"> = {
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    ...(status === undefined ? {} : { status }),
    ...(dependsOn === undefined ? {} : { dependsOn }),
    ...(clearDependencies ? { dependsOn: [] } : {}),
    ...(properties === undefined ? {} : { properties }),
  };
  if (command.command.name === "update" && Object.keys(changes).length === 0) throw new UsageError("Task update requires a title, description, status, dependency, or PR reference change.", help);
  const rawProjectId = command.options.get("--project") as string | undefined;
  let projectId: string | undefined;
  let taskId: string | undefined;
  if (rawProjectId !== undefined || command.command.name === "show" || command.command.name === "update") {
    const { canonicalId } = await import("../../api/parse.js");
    if (rawProjectId !== undefined) {
      projectId = canonicalId(rawProjectId) ?? undefined;
      if (projectId === undefined) throw new UsageError("project-id must be a hyphenated UUID.", help);
    }
    if (command.command.name === "show" || command.command.name === "update") {
      taskId = canonicalId(command.values[0]!) ?? undefined;
      if (taskId === undefined) throw new UsageError("task-id must be a hyphenated UUID.", help);
    }
  }
  const versionArgument = command.options.get("--if-version") as string | undefined;
  let expectedVersion: bigint | undefined;
  if (versionArgument !== undefined) {
    const { parseVersionArgument } = await import("../../api/json.js");
    try { expectedVersion = parseVersionArgument(versionArgument); }
    catch (cause) { throw new UsageError(cause instanceof Error ? cause.message : String(cause), help); }
  }
  await dependencies.runServerCommand(context, async ({ api, operation, serverUrl }) => {
    operation.check();
    let project: Project;
    if (projectId !== undefined) {
      project = await api.getProject(projectId);
    } else {
      project = await dependencies.resolveProject({ serverUrl, operation, api, workingDirectory: context.workingDirectory() });
    }
    operation.check();
    const { renderTask, renderTaskGraph, renderTaskJson, renderTaskList } = await import("./rendering.js");
    operation.check();
    if (command.command.name === "create") {
      const input: CreateTaskInput = { title: title!, ...(description === undefined ? {} : { description }), ...(dependsOn === undefined ? {} : { dependsOn }), ...(properties === undefined ? {} : { properties }) };
      const task = await api.createTask(project.id, input);
      operation.check();
      return `Task created.\n${renderTask(task)}`;
    }
    if (command.command.name === "list") {
      const filters: TaskFilters = { ...(status === undefined ? {} : { status }), ...(command.options.has("--ready") ? { ready: true } : {}) };
      const tasks = await api.listTasks(project.id, filters);
      operation.check();
      return command.options.has("--json") ? renderTaskJson(tasks) : renderTaskList(tasks);
    }
    if (command.command.name === "ready") {
      const tasks = await api.listReadyTasks(project.id, readyLimit);
      operation.check();
      return command.options.has("--json") ? renderTaskJson(tasks) : tasks.length === 0 ? "No ready tasks.\n" : renderTaskList(tasks);
    }
    if (command.command.name === "graph") {
      const graph = await api.getTaskGraph(project.id);
      operation.check();
      return command.options.has("--json") ? renderTaskJson(graph) : renderTaskGraph(graph);
    }
    if (command.command.name === "show") {
      const task = await api.getTask(project.id, taskId!);
      operation.check();
      return command.options.has("--json") ? renderTaskJson(task) : renderTask(task);
    }
    const version = expectedVersion === undefined ? (await api.getTask(project.id, taskId!)).version : expectedVersion;
    operation.check();
    const task = await api.updateTask(project.id, taskId!, { ...changes, version });
    operation.check();
    return `Task updated.\n${renderTask(task)}`;
  });
};
