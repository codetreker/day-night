import { UsageError } from "../../cli/context.js";
import type { CliContext } from "../../cli/context.js";
import { parseCommand, renderCommandHelp } from "../../cli/schema.js";
import { isNonemptyText } from "../../platform/text.js";
import type { runServerCommand } from "../server/runtime.js";
import { projectDefinition } from "./definition.js";

export type ProjectCommandDependencies = { runServerCommand: typeof runServerCommand };

const defaultDependencies: ProjectCommandDependencies = {
  runServerCommand: async (...args) => (await import("../server/runtime.js")).runServerCommand(...args),
};

export const runProjectCommand = async (
  args: readonly string[],
  context: CliContext,
  dependencies: ProjectCommandDependencies = defaultDependencies,
): Promise<void> => {
  const command = parseCommand(projectDefinition, args, ["daynight", "project"], "daynight project --help");
  if (command.kind !== "run") {
    context.stdout(renderCommandHelp(command.command, command.path));
    return;
  }
  const name = command.command.name === "create" ? command.values[0]! : undefined;
  if (name !== undefined && !isNonemptyText(name)) {
    throw new UsageError("Project name must be nonempty UTF-8 text without NUL characters.", "daynight project create --help");
  }
  let projectId: string | undefined;
  if (command.command.name === "show") {
    const { canonicalId } = await import("../../api/parse.js");
    projectId = canonicalId(command.values[0]!) ?? undefined;
    if (projectId === undefined) throw new UsageError("project-id must be a hyphenated UUID.", "daynight project show --help");
  }
  await dependencies.runServerCommand(context, async ({ api }) => {
    const { renderProject, renderProjectJson, renderProjectList } = await import("./rendering.js");
    if (command.command.name === "create") {
      const project = await api.createProject({ name: name!, repoUrl: command.options.get("--repo") as string });
      return `Project created.\n${renderProject(project)}`;
    }
    if (command.command.name === "list") {
      const projects = await api.listProjects();
      return command.options.has("--json") ? renderProjectJson(projects) : renderProjectList(projects);
    }
    const project = await api.getProject(projectId!);
    return command.options.has("--json") ? renderProjectJson(project) : renderProject(project);
  });
};
