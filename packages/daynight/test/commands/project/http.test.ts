import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stringifyApiJson } from "../../../src/api/index.js";
import type { Project } from "../../../src/api/index.js";
import { runProjectCommand } from "../../../src/commands/project/command.js";
import { runServerCommand } from "../../../src/commands/server/runtime.js";

const id = "abcdefab-1234-5678-90ab-abcdefabcdef";
const project: Project = { id, name: "Project 名称", repoUrl: "git@Git.Example:Org/Repo.git", createdAt: "2026-10-20T01:02:03.123456789Z", updatedAt: "2026-10-20T02:03:04.987654321Z" };
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});
const server = async (handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<string> => {
  const created = createServer(handler);
  await new Promise<void>((resolve) => created.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>((resolve, reject) => {
    created.close((error) => error === undefined ? resolve() : reject(error));
    created.closeAllConnections();
  }));
  const address = created.address();
  if (typeof address !== "object" || address === null) throw new Error("Missing server address");
  return `http://127.0.0.1:${address.port}`;
};
const fixture = async (serverUrl: string) => {
  const temporary = path.resolve(import.meta.dirname, "../../../../../.tmp/project-command-tests");
  await mkdir(temporary, { recursive: true });
  const home = await mkdtemp(path.join(temporary, "home 用户 "));
  cleanups.push(() => rm(home, { recursive: true, force: true }));
  await mkdir(path.join(home, ".daynight"));
  await writeFile(path.join(home, ".daynight/config.yml"), `serverUrl: ${serverUrl}\n`);
  const signals = new EventEmitter();
  const context = {
    version: "0.0.0", packageDirectory: "unused", homeDirectory: () => home,
    workingDirectory: vi.fn<() => string>(() => { throw new Error("Project commands must not query the working directory"); }),
    stdout: vi.fn<(value: string) => void>(), stderr: vi.fn<(value: string) => void>(),
  };
  const dependencies = { runServerCommand: (current: Parameters<typeof runServerCommand>[0], command: Parameters<typeof runServerCommand>[1]) => runServerCommand(current, command, { signalEmitter: signals }) };
  return { context, dependencies, signals };
};
const respond = (response: ServerResponse, value: unknown, status = 200) => {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(stringifyApiJson(value));
};

describe("project command over HTTP", () => {
  it("prints one complete JSON array after the final project page succeeds", async () => {
    const next = { ...project, id: "22222222-2222-2222-2222-222222222222", name: "Second\nProject" };
    const requests: string[] = [];
    let context: Awaited<ReturnType<typeof fixture>>["context"];
    const url = await server((request, response) => {
      requests.push(request.url!);
      expect(context.stdout).not.toHaveBeenCalled();
      const query = new URL(request.url!, "http://localhost").searchParams;
      respond(response, query.has("cursor") ? { items: [next], nextCursor: null } : { items: [project], nextCursor: "second page" });
    });
    const current = await fixture(url); context = current.context;
    await runProjectCommand(["list", "--json"], context, current.dependencies);
    expect(context.stdout).toHaveBeenCalledExactlyOnceWith(`${stringifyApiJson([project, next])}\n`);
    expect(requests).toEqual(["/api/v1/projects?limit=100", "/api/v1/projects?limit=100&cursor=second+page"]);
    expect(context.workingDirectory).not.toHaveBeenCalled();
    expect(current.signals.listenerCount("SIGINT")).toBe(0);
  });

  it("preserves a later-page refusal and leaves stdout empty", async () => {
    let requests = 0;
    const url = await server((_request, response) => {
      requests++;
      respond(response, requests === 1 ? { items: [project], nextCursor: "second" } : { error: { code: "internal", message: "Second page unavailable", requestId: "failed-page" } }, requests === 1 ? 200 : 500);
    });
    const { context, dependencies, signals } = await fixture(url);
    await expect(runProjectCommand(["list", "--json"], context, dependencies)).rejects.toMatchObject({ operation: "project.list", status: 500, code: "internal", requestId: "failed-page" });
    expect(context.stdout).not.toHaveBeenCalled();
    expect(context.workingDirectory).not.toHaveBeenCalled();
    expect(requests).toBe(2);
    expect(signals.listenerCount("SIGINT")).toBe(0);
  });

  it("submits original create values once and prints only the server-confirmed resource", async () => {
    const name = "  Original 名称  ";
    const repoUrl = "ssh://git@Git.Example:22/Org/Repo.git";
    let requests = 0;
    const bodies: unknown[] = [];
    const url = await server((request, response) => {
      requests++;
      expect(request.method).toBe("POST"); expect(request.url).toBe("/api/v1/projects");
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => { body += chunk; });
      request.on("end", () => { bodies.push(JSON.parse(body)); respond(response, { ...project, name, repoUrl }, 201); });
    });
    const { context, dependencies } = await fixture(url);
    await runProjectCommand(["create", "--name", name, "--repo", repoUrl], context, dependencies);
    expect(bodies).toEqual([{ name, repoUrl }]);
    expect(requests).toBe(1);
    expect(context.stdout).toHaveBeenCalledOnce();
    expect(context.stdout.mock.calls[0]![0]).toContain(`ID: ${project.id}\nName: ${name}\nRepository: ${repoUrl}\n`);
    expect(context.workingDirectory).not.toHaveBeenCalled();
  });

  it("queries an explicit canonical project ID and preserves full timestamps in JSON", async () => {
    const requests: string[] = [];
    const url = await server((request, response) => { requests.push(request.url!); respond(response, project); });
    const { context, dependencies } = await fixture(url);
    await runProjectCommand(["show", id.toUpperCase(), "--json"], context, dependencies);
    expect(requests).toEqual([`/api/v1/projects/${id}`]);
    expect(context.stdout).toHaveBeenCalledExactlyOnceWith(`${stringifyApiJson(project)}\n`);
    expect(context.workingDirectory).not.toHaveBeenCalled();
  });
});
