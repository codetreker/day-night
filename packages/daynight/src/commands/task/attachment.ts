import { constants } from "node:fs";
import { open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import mime from "mime";
import { canonicalId, validateAttachmentPath } from "../../api/parse.js";
import type { Project } from "../../api/types.js";
import { UsageError } from "../../cli/context.js";
import type { CliContext } from "../../cli/context.js";
import type { ParsedCommand } from "../../cli/schema.js";
import type { TaskCommandDependencies } from "./command.js";
import { renderAttachment, renderAttachmentJson, renderAttachmentList, renderAttachmentTree } from "./attachment-rendering.js";

const sourceBody = (file: FileHandle): ReadableStream<Uint8Array> => new ReadableStream<Uint8Array>({
  async pull(controller) {
    const buffer = new Uint8Array(64 * 1024);
    const { bytesRead } = await file.read(buffer);
    if (bytesRead === 0) controller.close();
    else controller.enqueue(buffer.subarray(0, bytesRead));
  },
});

export const runTaskAttachmentCommand = async (
  command: Extract<ParsedCommand, { kind: "run" }>,
  context: CliContext,
  dependencies: TaskCommandDependencies,
): Promise<void> => {
  const help = `${command.path.join(" ")} --help`;
  const taskId = canonicalId(command.values[0]!);
  if (taskId === null) throw new UsageError("task-id must be a hyphenated UUID.", help);
  const rawProjectId = command.options.get("--project") as string | undefined;
  const projectId = rawProjectId === undefined ? undefined : canonicalId(rawProjectId);
  if (projectId === null) throw new UsageError("project-id must be a hyphenated UUID.", help);
  if (command.options.has("--tree") && command.options.has("--json")) throw new UsageError("--tree and --json are mutually exclusive.", help);
  const name = command.command.name;
  const source = name === "put" ? command.values[1]! : undefined;
  const rawPath = name === "put" ? command.options.get("--path") as string | undefined ?? path.basename(source!) : command.values[1];
  let attachmentPath: string | undefined;
  if (rawPath !== undefined) {
    try { attachmentPath = validateAttachmentPath(rawPath); }
    catch (cause) { throw new UsageError(cause instanceof Error ? cause.message : String(cause), help); }
  }
  let file: FileHandle | undefined;
  let failure: unknown;
  try {
    if (source !== undefined) {
      file = await open(source, constants.O_RDONLY | constants.O_NONBLOCK);
      if (!(await file.stat()).isFile()) throw new UsageError("Attachment source must be a regular file.", help);
    }
    await dependencies.runServerCommand(context, async ({ api, operation, serverUrl }) => {
      operation.check();
      const project: Project = projectId === undefined
        ? await dependencies.resolveProject({ serverUrl, operation, api, workingDirectory: context.workingDirectory() })
        : await api.getProject(projectId);
      operation.check();
      if (name === "put") {
        const contentType = mime.getType(attachmentPath!) ?? "application/octet-stream";
        const attachment = await api.putTaskAttachment(project.id, taskId, attachmentPath!, { body: sourceBody(file!), contentType });
        operation.check();
        return `Attachment uploaded.\n${renderAttachment(attachment)}`;
      }
      if (name === "list") {
        const attachments = await api.listTaskAttachments(project.id, taskId);
        operation.check();
        return command.options.has("--json") ? renderAttachmentJson(attachments) : command.options.has("--tree") ? renderAttachmentTree(attachments) : renderAttachmentList(attachments);
      }
      if (name === "read") {
        await api.readTaskAttachment(project.id, taskId, attachmentPath!, (chunk, signal) => context.stdoutBytes(chunk, signal));
        operation.check();
        return;
      }
      await api.removeTaskAttachment(project.id, taskId, attachmentPath!);
      operation.check();
      return "Attachment removed.\n";
    });
  } catch (cause) {
    failure = cause;
    throw cause;
  } finally {
    try { await file?.close(); }
    catch (cause) {
      if (failure !== undefined) throw new AggregateError([failure, cause], "Attachment operation and source cleanup failed.", { cause: failure });
      throw cause;
    }
  }
};
