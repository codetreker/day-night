import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { Server, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { parseApiJson, stringifyApiJson } from "../../src/api/json.js";
import type { Project, Task, TaskGraph } from "../../src/api/types.js";

const executable = fileURLToPath(new URL("../../dist/main.js", import.meta.url));
const projectId = "a1b2c3d4-1111-4222-8333-123456789abc";
const taskId = "b1b2c3d4-1111-4222-8333-123456789abc";
const secondId = "b1b2c3d4-1111-4222-8333-123456789abd";
const thirdId = "b1b2c3d4-1111-4222-8333-123456789abe";
const time = "2026-10-20T00:00:00.123456789Z";
const project: Project = { id: projectId, name: "Project 中文", repoUrl: "git@git.example:Org/Repo.git", createdAt: time, updatedAt: time };
const task = (partial: Partial<Task> = {}): Task => ({ id: taskId, projectId, title: "Task 中文", description: "", properties: { pullRequests: [] }, status: "todo", version: 1n, createdAt: time, updatedAt: time, dependsOn: [], blockedBy: [], ready: true, ...partial });
const graph = (): TaskGraph => ({
  project,
  summary: { total: 1, todo: 1, inProgress: 0, done: 0, ready: 1, blocked: 0 },
  tasks: [{ id: taskId, titlePreview: "Task 中文", titleTruncated: false, status: "todo", dependsOn: [], blockedBy: [], ready: true, createdAt: time, updatedAt: time }],
});
const taskPath = `/api/v1/projects/${projectId}/tasks`;
const projectPath = `/api/v1/projects/${projectId}`;
const blockedReview = ["/commands/review/runtime.js", "/commands/review/store.js", "/commands/review/adapters/", "better-sqlite3"];
const blockedExplicit = ["/repository/", ...blockedReview];
const respond = (response: ServerResponse, value: unknown, status = 200): void => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(stringifyApiJson(value)); };
const refuse = (response: ServerResponse, code: string, requestId: string, status: number, details?: unknown): void => respond(response, { error: { code, message: "Controlled task refusal.", requestId, ...(details === undefined ? {} : { details }) } }, status);

type CapturedRequest = { method: string; pathname: string; query: URLSearchParams; bodyText: string; body: unknown };
type Result = { code: number | null; stdout: string; stderr: string };
type InvokeOptions = { blocked?: readonly string[]; cwd?: string; git?: boolean };

const fixture = async () => {
  const temporary = fileURLToPath(new URL("../../../../.tmp/", import.meta.url));
  await mkdir(temporary, { recursive: true });
  const root = await mkdtemp(path.join(temporary, "task CLI 中文-"));
  const home = path.join(root, "home");
  const caller = path.join(root, "caller");
  const emptyPath = path.join(root, "empty-path");
  const hook = path.join(root, "imports.mjs");
  await mkdir(caller); await mkdir(emptyPath);
  await writeFile(hook, `import { registerHooks } from 'node:module';
const blocked = JSON.parse(process.env.DAYNIGHT_TEST_BLOCK_IMPORTS);
registerHooks({ resolve(specifier, context, nextResolve) {
  const resolved = nextResolve(specifier, context);
  if (blocked.some(value => specifier.includes(value) || resolved.url.includes(value))) throw new Error('Unexpected module import: ' + specifier);
  return resolved;
} });
`);
  const nativeEnvironment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith("GIT_")));
  const environment = { ...nativeEnvironment, HOME: home, USERPROFILE: home, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: path.join(root, "git-global") };
  const servers: Server[] = [];
  const active = new Set<ReturnType<typeof spawn>>();
  const start = (args: readonly string[], options: InvokeOptions = {}) => {
    const child = spawn(process.execPath, ["--import", pathToFileURL(hook).href, executable, "task", ...args], {
      cwd: options.cwd ?? caller, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      env: { ...environment, ...(options.git ? {} : { PATH: emptyPath, Path: emptyPath }), DAYNIGHT_TEST_BLOCK_IMPORTS: JSON.stringify(options.blocked ?? blockedExplicit) },
    });
    active.add(child);
    const result = new Promise<Result>((resolve, reject) => {
      let stdout = "", stderr = "";
      let failure: Error | undefined;
      child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
      child.stdout.on("data", (value: string) => { stdout += value; });
      child.stderr.on("data", (value: string) => { stderr += value; });
      child.once("error", (error) => { failure = error; });
      const timer = setTimeout(() => { failure = new Error("Compiled task command exceeded its test deadline."); child.kill("SIGKILL"); }, 20_000);
      child.once("close", (code) => {
        active.delete(child); clearTimeout(timer);
        if (failure !== undefined) reject(failure); else resolve({ code, stdout, stderr });
      });
    });
    return { child, result };
  };
  const invoke = (args: readonly string[], options?: InvokeOptions) => start(args, options).result;
  const serve = async (handler: (request: CapturedRequest, response: ServerResponse) => void) => {
    const requests: CapturedRequest[] = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => { chunks.push(chunk); });
      request.on("end", () => {
        const url = new URL(request.url!, "http://localhost");
        const bodyText = Buffer.concat(chunks).toString("utf8");
        const captured = { method: request.method!, pathname: url.pathname, query: url.searchParams, bodyText, body: bodyText === "" ? null : parseApiJson(bodyText) };
        requests.push(captured);
        if (captured.method === "GET" && captured.pathname === projectPath) respond(response, project);
        else handler(captured, response);
      });
    });
    servers.push(server);
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); }); });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Missing controlled HTTP listener.");
    const serverUrl = `http://127.0.0.1:${address.port}`;
    await mkdir(path.join(home, ".daynight"), { recursive: true });
    await writeFile(path.join(home, ".daynight/config.yml"), `serverUrl: ${serverUrl}\n`);
    return { requests, serverUrl };
  };
  const git = (cwd: string, args: readonly string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", env: environment, timeout: 20_000, stdio: ["ignore", "pipe", "pipe"] });
  const initializeRepository = async (directory: string) => {
    await mkdir(directory, { recursive: true });
    git(directory, ["init", "--initial-branch=main"]);
    git(directory, ["config", "url.https://git.example/.insteadOf", "fixture:"]);
    git(directory, ["remote", "add", "origin", "fixture:Org/Repo.git"]);
  };
  const close = async () => {
    await Promise.all([...active].map((child) => new Promise<void>((resolve) => { child.once("close", () => resolve()); child.kill("SIGKILL"); })));
    for (const server of servers) {
      server.closeAllConnections();
      if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
    await rm(root, { recursive: true, force: true });
  };
  return { root, home, caller, invoke, start, serve, git, initializeRepository, close };
};

const explicit = ["--project", projectId];

describe("compiled task commands", () => {
  it("keeps all operation help and malformed arguments independent of configuration and business imports", async () => {
    const f = await fixture();
    try {
      const helpBlocked = ["/api/", "/config/", "/repository/", "/commands/server/", "/commands/task/rendering.js", "better-sqlite3"];
      for (const args of [[], ["--help"], ...["create", "list", "show", "update", "graph"].map((name) => [name, "--help"])]) {
        const result = await f.invoke(args, { blocked: helpBlocked });
        expect(result.code, result.stderr).toBe(0);
        expect(result.stdout).toContain("Usage: daynight task");
        expect(result.stderr).toBe("");
      }
      const validationBlocked = ["/api/client.js", "/api/operation.js", "/config/", "/repository/", "/commands/server/", "/commands/task/rendering.js", "better-sqlite3"];
      for (const args of [
        ["create"], ["create", "--title", "\u0085"], ["update", taskId],
        ["update", taskId, "--description", "", "--depends-on", secondId, "--clear-dependencies"],
        ["create", "--title", "Title", "--pull-request-url="],
        ["update", taskId, "--pull-request-title="],
        ["update", taskId, "--pull-request-url=", "--clear-pull-requests"],
        ["update", taskId, "--pull-request-title=", "--clear-pull-requests"],
        ["update", taskId, "--status", "invalid"],
        ["update", taskId, "--status", "done", "--if-version", "9223372036854775808"],
        ["show", "invalid"], ["list", "--project", "invalid"], ["list", "--ready", "false"], ["graph", "--unknown"],
      ]) {
        const result = await f.invoke(args, { blocked: validationBlocked });
        expect(result.code, result.stderr).toBe(2);
        expect(result.stdout).toBe("");
        expect(result.stderr).not.toContain("Unexpected module import");
        expect(result.stderr).not.toContain("configuration file");
      }
      await expect(readdir(f.home)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readdir(f.caller)).toEqual([]);
    } finally { await f.close(); }
  }, 60_000);

  it("preserves ordered raw PR lists through compiled mutations and complete text or JSON reads", async () => {
    const f = await fixture();
    try {
      const supplied = [{ url: "", title: "" }, { url: "-arbitrary=a,b", title: " 标题\n\u001b[2J " }, { url: "-arbitrary=a,b", title: " 标题\n\u001b[2J " }];
      const returned = { pullRequests: [...supplied, { url: "\0not a URL", title: "\0" }] };
      let current = task({ properties: returned, version: 9_223_372_036_854_775_807n });
      let conflict = false;
      const { requests } = await f.serve((request, response) => {
        if (request.method === "POST") respond(response, current, 201);
        else if (request.method === "PATCH") {
          if (conflict) refuse(response, "version_conflict", "pr-conflict", 409);
          else { current = { ...current, ...(request.body as object) }; respond(response, current); }
        } else if (request.pathname === taskPath) respond(response, { items: [current], nextCursor: null });
        else respond(response, current);
      });
      const pairs = ["--pull-request-url=", "--pull-request-title=", "--pull-request-url=-arbitrary=a,b", "--pull-request-url=-arbitrary=a,b", "--pull-request-title", supplied[1]!.title, "--pull-request-title", supplied[2]!.title];
      const created = await f.invoke(["create", "--title", "Title", ...pairs, ...explicit]);
      expect(created.code, created.stderr).toBe(0);
      expect(requests.find(({ method }) => method === "POST")!.body).toEqual({ title: "Title", properties: { pullRequests: supplied } });
      expect(created.stdout).toContain("Pull requests: 4");
      expect(created.stdout).toContain("4. Title: \\u0000\n     URL: \\u0000not a URL");
      for (const command of [["show", taskId], ["list"]]) {
        const json = await f.invoke([...command, "--json", ...explicit]);
        expect(json.code, json.stderr).toBe(0);
        expect(parseApiJson(json.stdout)).toEqual(command[0] === "list" ? [current] : current);
        const text = await f.invoke([...command, ...explicit]);
        expect(text.code, text.stderr).toBe(0);
        expect(text.stdout).toContain(" 标题\\n\\u001b[2J ");
        expect(text.stdout).toContain("\\u0000not a URL");
      }
      const before = requests.length;
      const replaced = await f.invoke(["update", taskId, ...pairs, ...explicit]);
      expect(replaced.code, replaced.stderr).toBe(0);
      expect(requests.slice(before).map(({ method }) => method)).toEqual(["GET", "GET", "PATCH"]);
      expect(requests.at(-1)!.body).toEqual({ version: 9_223_372_036_854_775_807n, properties: { pullRequests: supplied } });
      const clearAt = requests.length;
      const cleared = await f.invoke(["update", taskId, "--clear-pull-requests", "--if-version", "9223372036854775807", ...explicit]);
      expect(cleared.code, cleared.stderr).toBe(0);
      expect(cleared.stdout).toContain("Pull requests: 0");
      expect(requests.slice(clearAt).map(({ method }) => method)).toEqual(["GET", "PATCH"]);
      expect(requests.at(-1)!.body).toEqual({ version: 9_223_372_036_854_775_807n, properties: { pullRequests: [] } });
      conflict = true;
      const conflictAt = requests.length;
      const refused = await f.invoke(["update", taskId, ...pairs, ...explicit]);
      expect(refused.code).toBe(1); expect(refused.stdout).toBe(""); expect(refused.stderr).toContain("pr-conflict");
      expect(requests.slice(conflictAt).map(({ method }) => method)).toEqual(["GET", "GET", "PATCH"]);
    } finally { await f.close(); }
  }, 60_000);

  it("creates, shows, lists and graphs explicit projects without Git or repository imports", async () => {
    const f = await fixture();
    try {
      const title = "Task 中文\n\u001b[31m";
      const createdTask = task({ title, dependsOn: [secondId], blockedBy: [secondId], ready: false });
      const second = task({ id: secondId, title: "Second" });
      const cursor = "next page+/=?";
      const { requests } = await f.serve((request, response) => {
        if (request.method === "POST") respond(response, createdTask, 201);
        else if (request.pathname === `${taskPath}/${taskId}`) respond(response, createdTask);
        else if (request.pathname.endsWith("/task-graph")) respond(response, graph());
        else respond(response, request.query.has("cursor") ? { items: [second], nextCursor: null } : { items: [task()], nextCursor: cursor });
      });
      const created = await f.invoke(["create", "--title", title, "--description", "", "--depends-on", secondId, ...explicit]);
      expect(created.code, created.stderr).toBe(0);
      expect(created.stdout).toContain("Task created.");
      expect(created.stdout).toContain(taskId);
      expect(created.stdout).toContain("Task 中文\\n\\u001b[31m");
      expect(requests.find(({ method }) => method === "POST")!.body).toEqual({ title, description: "", dependsOn: [secondId] });

      const shown = await f.invoke(["show", taskId.toUpperCase(), "--project", projectId.toUpperCase(), "--json"]);
      expect(shown.code, shown.stderr).toBe(0);
      expect(parseApiJson(shown.stdout)).toEqual(createdTask);

      const listed = await f.invoke(["list", "--status", "todo", "--ready", "--json", ...explicit]);
      expect(listed.code, listed.stderr).toBe(0);
      expect(parseApiJson(listed.stdout)).toEqual([task(), second]);
      const pages = requests.filter(({ pathname }) => pathname === taskPath).filter(({ method }) => method === "GET");
      expect(pages.map(({ query }) => Object.fromEntries(query))).toEqual([
        { status: "todo", ready: "true", limit: "100" }, { status: "todo", ready: "true", limit: "100", cursor },
      ]);
      const graphed = await f.invoke(["graph", "--json", ...explicit]);
      expect(graphed.code, graphed.stderr).toBe(0);
      expect(JSON.parse(graphed.stdout)).toEqual(graph());
      expect([created, shown, listed, graphed].every(({ stderr }) => stderr === "")).toBe(true);
      expect(requests.filter(({ pathname }) => pathname === projectPath)).toHaveLength(4);
      expect(await readdir(f.caller)).toEqual([]);
      expect(await readdir(path.join(f.home, ".daynight"))).toEqual(["config.yml"]);
    } finally { await f.close(); }
  }, 60_000);

  it("submits one precise PATCH using the read version or an explicit full-int64 version and preserves dependency input", async () => {
    const f = await fixture();
    try {
      let refusal: "none" | "version" | "dependencies" = "none";
      const current = task({ version: 9_007_199_254_740_993n });
      const { requests } = await f.serve((request, response) => {
        if (request.method === "GET") respond(response, current);
        else if (refusal === "version") refuse(response, "version_conflict", "task-version-conflict", 409);
        else if (refusal === "dependencies") refuse(response, "invalid_input", "task-dependency-input", 400);
        else respond(response, { ...current, version: current.version + 1n });
      });
      const updated = await f.invoke(["update", taskId, "--description=", "--clear-dependencies", ...explicit]);
      expect(updated.code, updated.stderr).toBe(0);
      expect(updated.stdout).toContain("Task updated.");
      expect(requests.map(({ method, pathname }) => `${method} ${pathname}`)).toEqual([`GET ${projectPath}`, `GET ${taskPath}/${taskId}`, `PATCH ${taskPath}/${taskId}`]);
      expect(requests[2]!.body).toEqual({ description: "", dependsOn: [], version: current.version });
      expect(requests[2]!.bodyText).toContain('"version":9007199254740993');

      requests.length = 0; refusal = "version";
      const conflict = await f.invoke(["update", taskId, "--status", "done", "--if-version", "9223372036854775807", ...explicit]);
      expect(conflict.code).toBe(1); expect(conflict.stdout).toBe("");
      expect(conflict.stderr).toContain("version_conflict"); expect(conflict.stderr).toContain("task-version-conflict");
      expect(requests.map(({ method, pathname }) => `${method} ${pathname}`)).toEqual([`GET ${projectPath}`, `PATCH ${taskPath}/${taskId}`]);
      expect(requests[1]!.bodyText).toContain('"version":9223372036854775807');
      expect(requests[1]!.body).toEqual({ status: "done", version: 9_223_372_036_854_775_807n });

      requests.length = 0; refusal = "dependencies";
      const rejected = await f.invoke(["update", taskId, "--if-version", "2", "--depends-on", thirdId, "--depends-on", secondId, "--depends-on", thirdId, ...explicit]);
      expect(rejected.code).toBe(1); expect(rejected.stdout).toBe("");
      expect(rejected.stderr).toContain("task-dependency-input");
      expect(requests.map(({ method, pathname }) => `${method} ${pathname}`)).toEqual([`GET ${projectPath}`, `PATCH ${taskPath}/${taskId}`]);
      expect(requests[1]!.body).toEqual({ dependsOn: [thirdId, secondId, thirdId], version: 2n });
    } finally { await f.close(); }
  }, 60_000);

  it("keeps failed pages and graphs out of stdout and reports unconfirmed writes without retries", async () => {
    const f = await fixture();
    try {
      let mode: "pages" | "graph" | "write" = "pages";
      const { requests } = await f.serve((request, response) => {
        if (mode === "write") response.socket!.destroy();
        else if (mode === "graph") refuse(response, "graph_limit_exceeded", "task-graph-limit", 409, { nodeCount: 1001, edgeCount: 0, maxNodes: 1000, maxEdges: 5000 });
        else if (request.query.has("cursor")) refuse(response, "internal_error", "task-later-page", 500);
        else respond(response, { items: [task()], nextCursor: "later page" });
      });
      const failedPage = await f.invoke(["list", "--json", ...explicit]);
      expect(failedPage.code).toBe(1); expect(failedPage.stdout).toBe("");
      expect(failedPage.stderr).toContain("internal_error"); expect(failedPage.stderr).toContain("task-later-page");
      expect(requests.filter(({ pathname }) => pathname === taskPath)).toHaveLength(2);
      mode = "graph";
      const failedGraph = await f.invoke(["graph", "--json", ...explicit]);
      expect(failedGraph.code).toBe(1); expect(failedGraph.stdout).toBe("");
      for (const value of ["graph_limit_exceeded", "task-graph-limit", "1001", "1000", "5000"]) expect(failedGraph.stderr).toContain(value);
      mode = "write";
      const uncertain = await f.invoke(["create", "--title", "Uncertain", ...explicit]);
      expect(uncertain.code).toBe(1); expect(uncertain.stdout).toBe("");
      for (const value of ["task.create", projectId, "unconfirmed"]) expect(uncertain.stderr).toContain(value);
      expect(requests.filter(({ method }) => method === "POST")).toHaveLength(1);
    } finally { await f.close(); }
  }, 60_000);

  it("discovers from real Git before creating a task, reuses its binding and prevents mutation when local preparation fails", async () => {
    const f = await fixture();
    try {
      await f.initializeRepository(f.caller);
      const subdirectory = path.join(f.caller, "source files"); await mkdir(subdirectory);
      await writeFile(path.join(f.caller, ".gitignore"), "# Keep this rule\r\n");
      let bindingPresentAtMutation = false;
      const { requests, serverUrl } = await f.serve((request, response) => {
        if (request.pathname === "/api/v1/projects") respond(response, request.query.has("cursor")
          ? { items: [project], nextCursor: null }
          : { items: [{ ...project, id: thirdId, repoUrl: "https://other.example/Other/Repo" }], nextCursor: "project page two" });
        else if (request.method === "POST") {
          bindingPresentAtMutation = existsSync(path.join(f.caller, ".daynight/project.yml")) && readFileSync(path.join(f.caller, ".gitignore"), "utf8").includes("/.daynight/");
          respond(response, task(), 201);
        } else respond(response, { items: [task()], nextCursor: null });
      });
      const options = { git: true, cwd: subdirectory, blocked: blockedReview };
      const created = await f.invoke(["create", "--title", "Automatic"], options);
      expect(created.code, created.stderr).toBe(0);
      expect(bindingPresentAtMutation).toBe(true);
      expect(parse(await readFile(path.join(f.caller, ".daynight/project.yml"), "utf8"))).toEqual({ serverUrl, repoIdentity: "git.example/Org/Repo", projectId });
      expect(await readFile(path.join(f.caller, ".gitignore"), "utf8")).toContain("# Keep this rule\r\n");
      expect(f.git(f.caller, ["check-ignore", "--", ".daynight/", ".daynight/project.yml"]).trim().split(/\r?\n/)).toEqual([".daynight/", ".daynight/project.yml"]);
      const discoveries = requests.filter(({ pathname }) => pathname === "/api/v1/projects");
      expect(discoveries).toHaveLength(2);
      expect(discoveries[1]!.query.get("cursor")).toBe("project page two");
      const beforeCached = requests.length;
      const cached = await f.invoke(["list", "--json"], options);
      expect(cached.code, cached.stderr).toBe(0);
      expect(parseApiJson(cached.stdout)).toEqual([task()]);
      expect(requests.slice(beforeCached).map(({ method, pathname }) => `${method} ${pathname}`)).toEqual([`GET ${projectPath}`, `GET ${taskPath}`]);

      const blockedRepository = path.join(f.root, "blocked repository");
      await f.initializeRepository(blockedRepository);
      await mkdir(path.join(blockedRepository, ".gitignore"));
      const mutationCount = requests.filter(({ method }) => method === "POST").length;
      const failed = await f.invoke(["create", "--title", "Must not be submitted"], { ...options, cwd: blockedRepository });
      expect(failed.code).toBe(1); expect(failed.stdout).toBe("");
      expect(failed.stderr).toContain(".gitignore");
      expect(requests.filter(({ method }) => method === "POST")).toHaveLength(mutationCount);
      await expect(readFile(path.join(blockedRepository, ".daynight/project.yml"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await f.close(); }
  }, 60_000);

  it.skipIf(process.platform === "win32")("handles actual SIGINT during a dispatched mutation without publishing success", async () => {
    const f = await fixture();
    try {
      let received: () => void = () => {};
      const ready = new Promise<void>((resolve) => { received = resolve; });
      const { requests } = await f.serve((_request, response) => { response.writeHead(201, { "Content-Type": "application/json" }); response.write('{"id":'); received(); });
      const running = f.start(["create", "--title", "Cancelled", ...explicit]);
      await Promise.race([ready, running.result.then((result) => { throw new Error(`Task exited before the mutation reached the server: ${result.code}: ${result.stderr}`); })]);
      expect(running.child.kill("SIGINT")).toBe(true);
      const cancelled = await running.result;
      expect(cancelled.code).toBe(1); expect(cancelled.stdout).toBe("");
      for (const value of ["task.create", projectId, "cancelled", "SIGINT", "unconfirmed"]) expect(cancelled.stderr).toContain(value);
      expect(requests.filter(({ method }) => method === "POST")).toHaveLength(1);
    } finally { await f.close(); }
  }, 30_000);
});
