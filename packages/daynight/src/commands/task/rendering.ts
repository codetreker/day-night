import { stringifyApiJson } from "../../api/json.js";
import type { GraphTask, Task, TaskGraph } from "../../api/types.js";
import { terminalText } from "../../platform/terminal.js";

const identifiers = (values: readonly string[]): string => values.length === 0 ? "none" : values.map(terminalText).join(", ");

export const renderTask = (task: Task): string => [
  `ID: ${terminalText(task.id)}`,
  `Project: ${terminalText(task.projectId)}`,
  `Title: ${terminalText(task.title)}`,
  `Description: ${terminalText(task.description)}`,
  `Pull requests: ${task.properties.pullRequests.length}`,
  ...task.properties.pullRequests.flatMap((pullRequest, index) => [
    `  ${index + 1}. Title: ${terminalText(pullRequest.title)}`,
    `     URL: ${terminalText(pullRequest.url)}`,
  ]),
  `Status: ${terminalText(task.status)}`,
  `Version: ${task.version}`,
  `Ready: ${task.ready}`,
  `Depends on: ${identifiers(task.dependsOn)}`,
  `Blocked by: ${identifiers(task.blockedBy)}`,
  `Created: ${terminalText(task.createdAt)}`,
  `Updated: ${terminalText(task.updatedAt)}`,
  "",
].join("\n");

export const renderTaskList = (tasks: readonly Task[]): string => tasks.length === 0 ? "No tasks.\n" : tasks.map(renderTask).join("\n");

const renderGraphTask = (task: GraphTask): string => [
  `ID: ${terminalText(task.id)}`,
  `Title preview: ${terminalText(task.titlePreview)}`,
  `Title truncated: ${task.titleTruncated}`,
  `Status: ${terminalText(task.status)}`,
  `Ready: ${task.ready}`,
  `Depends on: ${identifiers(task.dependsOn)}`,
  `Blocked by: ${identifiers(task.blockedBy)}`,
  `Created: ${terminalText(task.createdAt)}`,
  `Updated: ${terminalText(task.updatedAt)}`,
  "",
].join("\n");

export const renderTaskGraph = (graph: TaskGraph): string => [
  `Project: ${terminalText(graph.project.id)}`,
  `Name: ${terminalText(graph.project.name)}`,
  `Repository: ${terminalText(graph.project.repoUrl)}`,
  `Created: ${terminalText(graph.project.createdAt)}`,
  `Updated: ${terminalText(graph.project.updatedAt)}`,
  "",
  "Summary:",
  `Total: ${graph.summary.total}`,
  `Todo: ${graph.summary.todo}`,
  `In progress: ${graph.summary.inProgress}`,
  `Done: ${graph.summary.done}`,
  `Ready: ${graph.summary.ready}`,
  `Blocked: ${graph.summary.blocked}`,
  "",
  graph.tasks.length === 0 ? "No tasks.\n" : graph.tasks.map(renderGraphTask).join("\n"),
].join("\n");

export const renderTaskJson = (value: Task | readonly Task[] | TaskGraph): string => `${stringifyApiJson(value)}\n`;
