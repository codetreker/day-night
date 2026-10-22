import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import crossSpawn from "cross-spawn";
import { parse } from "yaml";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createInstalledCli, terminateInstalledProcess } from "../fixtures/installed-cli.js";

type Result = { code: number | null; stdout: string; stderr: string };
type Action = { waitFor: string; input: string } | { waitFor: string; signal: "SIGTERM" };
let installed: Awaited<ReturnType<typeof createInstalledCli>>;
let sequence = 0;
const remote = "https://github.com/Setup-Acceptance/Repository.git";
const serverPrompt = "Server URL (for example http://127.0.0.1:8787): ";
const tokenPrompt = "Server token (hidden; blank to skip): ";
const keepTokenPrompt = "Server token (hidden; blank to keep current token): ";
const reviewPrompt = "Review repository (HTTPS or SSH GitHub address): ";
const pathPrompt = "Review clone path (blank for configured default): ";

beforeAll(async () => { installed = await createInstalledCli(); });
afterAll(async () => { await installed?.cleanup(); });

const environment = (home: string): NodeJS.ProcessEnv => {
  const result = { ...process.env };
  for (const name of Object.keys(result)) if (/^(?:GIT_|GH_|GITHUB_|COPILOT_|NODE_OPTIONS$|DAYNIGHT_)/i.test(name)) delete result[name];
  return { ...result, HOME: home, USERPROFILE: home, NO_COLOR: "1" };
};
const fresh = async (): Promise<{ root: string; home: string; configuration: string }> => {
  const root = path.join(installed.receipt.root, `guided setup ${sequence++}`);
  const home = path.join(root, "home 中文");
  await mkdir(home, { recursive: true });
  return { root, home, configuration: path.join(home, ".daynight/config.yml") };
};
const capture = async (child: ChildProcess, input?: string): Promise<Result> => {
  let stdout = "", stderr = "";
  child.stdout!.setEncoding("utf8").on("data", (value: string) => { stdout += value; });
  child.stderr!.setEncoding("utf8").on("data", (value: string) => { stderr += value; });
  if (input !== undefined) child.stdin!.end(input);
  let launchFailure: Error | undefined;
  child.once("error", (cause) => { launchFailure = cause; });
  const closed = new Promise<number | null>((resolve) => child.once("close", resolve));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const code = await Promise.race([closed, new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), 15_000); })]);
    if (code === "timeout") { await terminateInstalledProcess(child, closed); throw new Error(`Setup command exceeded fifteen seconds: ${stderr}`); }
    if (launchFailure !== undefined) throw launchFailure;
    return { code, stdout, stderr };
  } finally { if (timer !== undefined) clearTimeout(timer); }
};
const pipe = (args: string[], home: string, cwd = home, input?: string): Promise<Result> => capture(crossSpawn(installed.receipt.launcherPath, args, {
  cwd, env: environment(home), windowsHide: true, detached: process.platform !== "win32", stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
}), input);
const terminal = async (args: string[], home: string, actions: Action[], extraEnvironment: NodeJS.ProcessEnv = {}, stderrTerminal = true): Promise<Result> => {
  const result = await capture(spawn("python3", ["-u", path.join(import.meta.dirname, "setup-pty.py")], {
    cwd: home, detached: true, stdio: ["pipe", "pipe", "pipe"],
  }), JSON.stringify({ command: [installed.receipt.launcherPath, ...args], cwd: home, environment: { ...environment(home), ...extraEnvironment }, actions, stderrTerminal }));
  expect(result.code, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as Result;
};
const decoded = async (file: string): Promise<Record<string, unknown>> => parse(await readFile(file, "utf8")) as Record<string, unknown>;

it("configures only explicitly selected capabilities through the installed launcher with nonterminal input", async () => {
  const first = await fresh();
  const missing = await pipe(["project", "list", "--json"], first.home);
  expect(missing.code).toBe(1);
  expect(missing.stdout).toBe("");
  expect(missing.stderr).toContain("daynight setup");
  expect(await readdir(first.home)).toEqual([]);
  expect((await pipe(["review", "list"], first.home)).code).toBe(1);
  expect((await pipe(["setup"], first.home)).code).toBe(1);
  expect(await readdir(first.home)).toEqual([]);

  const setup = await pipe(["setup", "--server-url", "http://127.0.0.1:8787"], first.home);
  expect(setup.code, setup.stderr).toBe(0);
  expect(await decoded(first.configuration)).toEqual({ serverUrl: "http://127.0.0.1:8787" });
  const review = await pipe(["setup", "--review-repo", remote, "--review-path", path.join(first.root, "review clone")], first.home);
  expect(review.code, review.stderr).toBe(0);
  expect(await decoded(first.configuration)).toMatchObject({ serverUrl: "http://127.0.0.1:8787", repositories: [{ remote, path: path.join(first.root, "review clone") }] });

  const reviewOnly = await fresh();
  const explicitReview = await pipe(["setup", "--review-repo", remote], reviewOnly.home);
  expect(explicitReview.code, explicitReview.stderr).toBe(0);
  expect(await decoded(reviewOnly.configuration)).not.toHaveProperty("serverUrl");
  const both = await fresh();
  const explicitBoth = await pipe(["setup", "--server-url", "https://service.example", "--review-repo", remote], both.home);
  expect(explicitBoth.code, explicitBoth.stderr).toBe(0);
  expect(await decoded(both.configuration)).toMatchObject({ serverUrl: "https://service.example", repositories: [{ remote }] });

  const invalid = await fresh();
  expect((await pipe(["setup", "--review-path", "clone"], invalid.home)).code).not.toBe(0);
  expect(await readdir(invalid.home)).toEqual([]);
});

it.skipIf(process.platform === "win32")("uses real terminal setup for server and review independently while preserving piped JSON output", async () => {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ items: [], nextCursor: null }));
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try {
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Missing setup acceptance HTTP listener.");
    const serverUrl = `http://127.0.0.1:${address.port}`;
    const first = await fresh();
    const listed = await terminal(["project", "list", "--json"], first.home, [{ waitFor: serverPrompt, input: `${serverUrl}\n` }, { waitFor: tokenPrompt, input: "\n" }]);
    expect(listed.code, listed.stderr).toBe(0);
    expect(JSON.parse(listed.stdout)).toEqual([]);
    expect(listed.stderr).not.toContain(reviewPrompt);
    expect(await decoded(first.configuration)).toEqual({ serverUrl });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatch(/^GET \/api\/v1\/projects(?:\?|$)/);

    const redirectedErrors = await fresh();
    const noninteractive = await terminal(["project", "list", "--json"], redirectedErrors.home, [], {}, false);
    expect(noninteractive.code).toBe(1);
    expect(noninteractive.stdout).toBe("");
    expect(noninteractive.stderr).not.toContain(serverPrompt);
    expect(await readdir(redirectedErrors.home)).toEqual([]);

    const review = await fresh();
    const tools = path.join(review.root, "tools");
    await mkdir(tools);
    const subprocessLog = path.join(review.root, "unexpected-subprocess");
    for (const tool of ["git", "gh", "copilot"]) {
      const script = path.join(tools, tool);
      await writeFile(script, "#!/bin/sh\nprintf unexpected >> \"$SETUP_SUBPROCESS_LOG\"\nexit 97\n");
      await chmod(script, 0o755);
    }
    const snapshot = await terminal(["review", "list"], review.home, [
      { waitFor: reviewPrompt, input: `${remote}\n` }, { waitFor: pathPrompt, input: "\n" },
    ], { PATH: `${tools}${path.delimiter}${process.env.PATH!}`, SETUP_SUBPROCESS_LOG: subprocessLog });
    expect(snapshot.code, snapshot.stderr).toBe(0);
    expect(snapshot.stdout).toContain("Local persisted snapshot");
    expect(snapshot.stdout).toContain("github.com/setup-acceptance/repository");
    expect(snapshot.stderr).not.toContain(serverPrompt);
    expect(await decoded(review.configuration)).not.toHaveProperty("serverUrl");
    await expect(readFile(subprocessLog)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(path.join(review.home, ".daynight"))).toEqual(["config.yml"]);
    await expect(readFile(path.join(review.home, "daynights"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally { await new Promise<void>((resolve, reject) => server.close((cause) => cause === undefined ? resolve() : reject(cause))); }
});

it.skipIf(process.platform === "win32")("commits an interactive combined setup once and leaves original bytes intact on terminal cancellation or corrupt input", async () => {
  const serverOnly = await fresh();
  const selectedServer = await terminal(["setup"], serverOnly.home, [
    { waitFor: "Configure (server/review/both): ", input: "server\n" },
    { waitFor: serverPrompt, input: "https://service.example\n" },
    { waitFor: tokenPrompt, input: "\n" },
  ]);
  expect(selectedServer.code, selectedServer.stderr).toBe(0);
  expect(selectedServer.stderr).not.toContain(reviewPrompt);
  expect(await decoded(serverOnly.configuration)).toEqual({ serverUrl: "https://service.example" });
  const reviewOnly = await fresh();
  const selectedReview = await terminal(["setup"], reviewOnly.home, [
    { waitFor: "Configure (server/review/both): ", input: "review\n" },
    { waitFor: reviewPrompt, input: `${remote}\n` },
    { waitFor: pathPrompt, input: "\n" },
  ]);
  expect(selectedReview.code, selectedReview.stderr).toBe(0);
  expect(selectedReview.stderr).not.toContain(serverPrompt);
  expect(await decoded(reviewOnly.configuration)).not.toHaveProperty("serverUrl");
  const combined = await fresh();
  const configured = await terminal(["setup"], combined.home, [
    { waitFor: "Configure (server/review/both): ", input: "both\n" },
    { waitFor: serverPrompt, input: "https://service.example\n" },
    { waitFor: tokenPrompt, input: "\n" },
    { waitFor: reviewPrompt, input: `${remote}\n` },
    { waitFor: pathPrompt, input: "\n" },
  ]);
  expect(configured.code, configured.stderr).toBe(0);
  expect(await decoded(combined.configuration)).toMatchObject({ serverUrl: "https://service.example", repositories: [{ remote }] });
  expect(configured.stderr.match(/Configuration saved to/g)).toHaveLength(1);

  const firstUse = await fresh();
  const cancelledFirstUse = await terminal(["project", "list"], firstUse.home, [{ waitFor: serverPrompt, input: "\u0003" }]);
  expect(cancelledFirstUse.code).toBe(1);
  expect(await readdir(firstUse.home)).toEqual([]);

  for (const cancellation of [{ input: "\u0003" }, { input: "\u0004" }, { signal: "SIGTERM" as const }]) {
    const fixture = await fresh();
    await mkdir(path.dirname(fixture.configuration));
    const original = "# Existing preferences\nserverUrl: https://old.example\npollIntervalMs: 1234\n";
    await writeFile(fixture.configuration, original);
    const result = await terminal(["setup"], fixture.home, [
      { waitFor: "Configure (server/review/both): ", input: "both\n" },
      { waitFor: serverPrompt, input: "https://replacement.example\n" },
      { waitFor: tokenPrompt, input: "\n" },
      { waitFor: reviewPrompt, ...cancellation },
    ]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Setup cancelled.");
    expect(await readFile(fixture.configuration, "utf8")).toBe(original);
    expect(await readdir(path.dirname(fixture.configuration))).toEqual(["config.yml"]);
  }
  const corrupt = await fresh();
  await mkdir(path.dirname(corrupt.configuration));
  await writeFile(corrupt.configuration, "serverUrl: [\n");
  const failed = await terminal(["project", "list", "--json"], corrupt.home, []);
  expect(failed.code).toBe(1);
  expect(failed.stdout).toBe("");
  expect(failed.stderr).not.toContain(serverPrompt);
  expect(await readFile(corrupt.configuration, "utf8")).toBe("serverUrl: [\n");
});

it("reads token stdin through the installed launcher and rejects invalid input without disclosing credentials", async () => {
  const fixture = await fresh();
  const secret = "installed-stdin-secret";
  const configured = await pipe(["setup", "--server-url", "https://service.example", "--server-token-stdin"], fixture.home, fixture.home, `${secret}\r\n`);
  expect(configured.code, configured.stderr).toBe(0);
  expect(await decoded(fixture.configuration)).toEqual({ serverUrl: "https://service.example", serverToken: secret });
  expect(configured.stdout).toBe("");
  expect(configured.stderr).not.toContain(secret);
  expect(configured.stderr).not.toContain(serverPrompt);
  expect(configured.stderr).not.toContain(tokenPrompt);
  const original = await readFile(fixture.configuration, "utf8");
  for (const input of ["", "\n", "invalid-secret\nsecond-line\n", "oversized-secret-" + "x".repeat(1024 * 1024)]) {
    const failed = await pipe(["setup", "--server-token-stdin"], fixture.home, fixture.home, input);
    expect(failed.code).toBe(1);
    expect(failed.stdout).toBe("");
    expect(failed.stderr).toContain("serverToken");
    expect(failed.stderr).not.toContain(secret);
    expect(failed.stderr).not.toContain("invalid-secret");
    expect(failed.stderr).not.toContain("oversized-secret-");
    expect(await readFile(fixture.configuration, "utf8")).toBe(original);
    expect(await readdir(path.dirname(fixture.configuration))).toEqual(["config.yml"]);
  }
});

it.skipIf(process.platform === "win32")("hides token terminal input and preserves the original configuration when the secret prompt is cancelled", async () => {
  const fixture = await fresh();
  const secret = "native-terminal-secret";
  const configured = await terminal(["setup"], fixture.home, [
    { waitFor: "Configure (server/review/both): ", input: "server\n" },
    { waitFor: serverPrompt, input: "https://service.example\n" },
    { waitFor: tokenPrompt, input: `${secret}\n` },
  ]);
  expect(configured.code, configured.stderr).toBe(0);
  expect(await decoded(fixture.configuration)).toEqual({ serverUrl: "https://service.example", serverToken: secret });
  expect(configured.stderr).not.toContain(secret);
  expect(configured.stdout).toBe("");
  const original = await readFile(fixture.configuration, "utf8");
  for (const cancellation of [{ input: "\u0003" }, { input: "\u0004" }, { signal: "SIGTERM" as const }]) {
    const cancelled = await terminal(["setup"], fixture.home, [
      { waitFor: "Configure (server/review/both): ", input: "server\n" },
      { waitFor: serverPrompt, input: "https://service.example\n" },
      { waitFor: keepTokenPrompt, ...cancellation },
    ]);
    expect(cancelled.code).toBe(1);
    expect(cancelled.stderr).toContain("Setup cancelled.");
    expect(cancelled.stderr).not.toContain(secret);
    expect(await readFile(fixture.configuration, "utf8")).toBe(original);
    expect(await readdir(path.dirname(fixture.configuration))).toEqual(["config.yml"]);
  }
});
