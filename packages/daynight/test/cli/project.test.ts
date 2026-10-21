import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const executable = fileURLToPath(new URL("../../dist/main.js", import.meta.url));
const projectId = "a1b2c3d4-1111-4222-8333-123456789abc";
const secondId = "a1b2c3d4-1111-4222-8333-123456789abd";
const project = (id = projectId, name = "Project 中文") => ({
  id, name, repoUrl: "git@git.example:Org/Repo.git",
  createdAt: "2026-10-20T00:00:00.123456789Z", updatedAt: "2026-10-20T00:00:00.123456789Z",
});

const fixture = async () => {
  const temporary = fileURLToPath(new URL("../../../../.tmp/", import.meta.url));
  await mkdir(temporary, { recursive: true });
  const root = await mkdtemp(path.join(temporary, "project CLI 中文-"));
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
  const invoke = (args: readonly string[], blocked: readonly string[]) => new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", pathToFileURL(hook).href, executable, ...args], {
      cwd: caller, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, HOME: home, USERPROFILE: home, PATH: emptyPath, Path: emptyPath, DAYNIGHT_TEST_BLOCK_IMPORTS: JSON.stringify(blocked) },
    });
    let stdout = "";
    let stderr = "";
    let failure: Error | undefined;
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (value: string) => { stdout += value; });
    child.stderr.on("data", (value: string) => { stderr += value; });
    child.once("error", (error) => { failure = error; });
    const timer = setTimeout(() => { failure = new Error("Compiled project command exceeded its test deadline."); child.kill("SIGKILL"); }, 10_000);
    child.once("close", (code) => {
      clearTimeout(timer);
      if (failure !== undefined) reject(failure);
      else resolve({ code, stdout, stderr });
    });
  });
  return { root, home, caller, invoke };
};

describe("compiled project commands", () => {
  it("keeps help and malformed arguments independent of configuration and business imports", async () => {
    const f = await fixture();
    const blocked = ["/api/", "/config/", "/repository/", "/commands/server/", "/commands/project/rendering.js", "better-sqlite3"];
    try {
      for (const args of [[], ["--help"], ["create", "--help"], ["list", "--help"], ["show", "--help"]]) {
        const result = await f.invoke(["project", ...args], blocked);
        expect(result.code, result.stderr).toBe(0);
        expect(result.stdout).toContain("Usage: daynight project");
        expect(result.stderr).toBe("");
      }
      for (const args of [["create", "Example"], ["create", "--name", "Example", "--repo", "remote"], ["create", "Name", "extra", "--repo", "remote"], ["create", "--repo", "remote"], ["create", "--repo", "remote", "-leading"], ["create", "\u0085", "--repo", "git@git.example:Org/Repo"], ["list", "--unknown"]]) {
        const result = await f.invoke(["project", ...args], blocked);
        expect(result.code, result.stderr).toBe(2);
        expect(result.stdout).toBe("");
        expect(result.stderr).not.toContain("Unexpected module import");
      }
      const invalidId = await f.invoke(["project", "show", "not-a-uuid"], ["/api/client.js", "/api/json.js", "/api/operation.js", "/config/", "/commands/server/", "/repository/", "better-sqlite3"]);
      expect(invalidId.code, invalidId.stderr).toBe(2);
      expect(invalidId.stderr).toContain("hyphenated UUID");
      await expect(readdir(f.home)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readdir(f.caller)).toEqual([]);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }, 30_000);

  it("uses the configured server outside Git and publishes only complete API results", async () => {
    const f = await fixture();
    const requests: { method: string; pathname: string; cursor: string | null; body: unknown }[] = [];
    let failSecondPage = false;
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => { chunks.push(chunk); });
      request.on("end", () => {
        const url = new URL(request.url!, "http://localhost");
        const body = chunks.length === 0 ? null : JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
        requests.push({ method: request.method!, pathname: url.pathname, cursor: url.searchParams.get("cursor"), body });
        response.setHeader("Content-Type", "application/json");
        if (request.method === "POST") {
          const input = body as { name: string; repoUrl: string };
          response.writeHead(201).end(JSON.stringify({ ...project(), ...input }));
        } else if (url.pathname === `/api/v1/projects/${projectId}`) {
          response.end(JSON.stringify(project()));
        } else if (url.searchParams.has("cursor")) {
          if (failSecondPage) response.writeHead(500).end(JSON.stringify({ error: { code: "internal_error", message: "Controlled page failure", requestId: "project-page-failure" } }));
          else response.end(JSON.stringify({ items: [project(secondId, "\uFEFF")], nextCursor: null }));
        } else {
          response.end(JSON.stringify({ items: [project()], nextCursor: "next page+/=?" }));
        }
      });
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
      });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Missing controlled HTTP listener.");
    await mkdir(path.join(f.home, ".daynight"), { recursive: true });
    await writeFile(path.join(f.home, ".daynight/config.yml"), `serverUrl: http://127.0.0.1:${address.port}\n`);
    const blocked = ["/repository/", "/commands/review/runtime.js", "/commands/review/store.js", "better-sqlite3"];
      const list = await f.invoke(["project", "list", "--json"], blocked);
      expect(list.code, list.stderr).toBe(0);
      expect(list.stderr).toBe("");
      expect(JSON.parse(list.stdout)).toEqual([project(), project(secondId, "\uFEFF")]);
      expect(requests[1]!.cursor).toBe("next page+/=?");

      const show = await f.invoke(["project", "show", projectId.toUpperCase(), "--json"], blocked);
      expect(show.code, show.stderr).toBe(0);
      expect(JSON.parse(show.stdout)).toEqual(project());
      expect(requests[2]!.pathname).toBe(`/api/v1/projects/${projectId}`);

      const name = "名字\n\u001b[31m";
      const remote = "ssh://git@Git.Example/Org/Repo.git";
      const created = await f.invoke(["project", "create", name, "--repo", remote], blocked);
      expect(created.code, created.stderr).toBe(0);
      expect(created.stdout).toContain("Project created.");
      expect(created.stdout).toContain("名字\\n\\u001b[31m");
      expect(requests.filter(({ method }) => method === "POST")).toEqual([{ method: "POST", pathname: "/api/v1/projects", cursor: null, body: { name, repoUrl: remote } }]);

      for (const name of [" Name 中文 ", "\ufeff", "-leading"]) {
        const created = await f.invoke(["project", "create", "--repo", remote, "--", name], blocked);
        expect(created.code, created.stderr).toBe(0);
        expect(requests.at(-1)!.body).toEqual({ name, repoUrl: remote });
      }

      failSecondPage = true;
      const failed = await f.invoke(["project", "list", "--json"], blocked);
      expect(failed.code).toBe(1);
      expect(failed.stdout).toBe("");
      expect(failed.stderr).toContain("internal_error");
      expect(failed.stderr).toContain("project-page-failure");
      expect(await readdir(f.caller)).toEqual([]);
      expect(await readdir(path.join(f.home, ".daynight"))).toEqual(["config.yml"]);
      expect(await readFile(path.join(f.home, ".daynight/config.yml"), "utf8")).toBe(`serverUrl: http://127.0.0.1:${address.port}\n`);
    } finally {
      server.closeAllConnections();
      if (server.listening) await new Promise<void>((resolve, reject) => { server.close((error) => { if (error) reject(error); else resolve(); }); });
      await rm(f.root, { recursive: true, force: true });
    }
  }, 30_000);
});
