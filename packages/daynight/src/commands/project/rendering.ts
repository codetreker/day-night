import { stringifyApiJson } from "../../api/json.js";
import type { Project } from "../../api/types.js";
import { terminalText } from "../../platform/terminal.js";

export const renderProject = (project: Project): string => [
  `ID: ${terminalText(project.id)}`,
  `Name: ${terminalText(project.name)}`,
  `Repository: ${terminalText(project.repoUrl)}`,
  `Created: ${terminalText(project.createdAt)}`,
  `Updated: ${terminalText(project.updatedAt)}`,
  "",
].join("\n");

export const renderProjectList = (projects: readonly Project[]): string => {
  if (projects.length === 0) return "No projects.\n";
  return projects.map(renderProject).join("\n");
};

export const renderProjectJson = (value: Project | readonly Project[]): string => `${stringifyApiJson(value)}\n`;
