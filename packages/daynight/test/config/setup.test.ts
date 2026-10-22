import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseDocument } from "yaml";
import type { CliContext } from "../../src/cli/context.js";
import { CliCancelledError } from "../../src/cli/cancellation.js";
import { runCli } from "../../src/cli/application.js";
import { MissingConfigurationFileError, isMissingConfiguration } from "../../src/config/errors.js";
import { readConfigurationSource } from "../../src/config/files.js";
import { resolveConfigurationPaths } from "../../src/config/paths.js";
import { configure } from "../../src/config/setup.js";
import { runServerCommand } from "../../src/commands/server/runtime.js";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

const fixture = async (source?: string) => {
  const temporary = path.resolve(import.meta.dirname, "../../../../.tmp/setup-tests");
  await mkdir(temporary, { recursive: true });
  const directory = await mkdtemp(path.join(temporary, "setup 用户-"));
  directories.push(directory);
  const paths = resolveConfigurationPaths(directory);
  if (source !== undefined) { await mkdir(paths.stateDirectory); await writeFile(paths.configFile, source); }
  const context: CliContext = {
    version: "0.0.0", packageDirectory: directory,
    homeDirectory: () => directory, workingDirectory: () => directory,
    stdoutBytes: vi.fn(async () => {}), stdout: vi.fn(), stderr: vi.fn(),
  };
  return { context, paths, directory };
};

const answers = (context: CliContext, values: readonly string[]) => {
  let index = 0;
  const ask = vi.fn(async () => {
    if (index >= values.length) throw new CliCancelledError();
    return values[index++]!;
  });
  context.prompt = { isInteractive: true, select: async () => { throw new Error("Unexpected select"); }, selectMany: async () => { throw new Error("Unexpected selectMany"); }, ask, close: vi.fn() };
  return ask;
};

describe("guided configuration transactions", () => {
  it("saves server-only configuration without looking up the working directory", async () => {
    const { context, paths } = await fixture();
    context.workingDirectory = () => { throw new Error("Server setup must not inspect cwd"); };
    answers(context, ["server", "invalid", "http://localhost:8787/"]);
    await configure(context);
    expect(parseDocument(await readFile(paths.configFile, "utf8")).toJS()).toEqual({ serverUrl: "http://localhost:8787" });
    expect(context.stderr).toHaveBeenCalledWith(expect.stringContaining("serverUrl must"));
    expect(context.stdout).not.toHaveBeenCalled();
    expect(await readdir(paths.stateDirectory)).toEqual(["config.yml"]);
  });

  it("collects both capabilities before writing and leaves no partial state on cancellation", async () => {
    const source = "# connection\nserverUrl: http://original:8787 # retained\n";
    const { context, paths } = await fixture(source);
    answers(context, ["both", "http://changed:8787", "https://github.com/owner/repo"]);
    await expect(configure(context)).rejects.toBeInstanceOf(CliCancelledError);
    expect(await readFile(paths.configFile, "utf8")).toBe(source);
    expect(await readdir(paths.stateDirectory)).toEqual(["config.yml"]);
    expect(context.stdout).not.toHaveBeenCalled();
  });

  it("registers review with the existing default on a fresh home without configuring server access", async () => {
    const { context, paths, directory } = await fixture();
    answers(context, ["review", "https://github.com/Owner/Repo.git", ""]);
    await configure(context);
    expect(parseDocument(await readFile(paths.configFile, "utf8")).toJS()).toEqual({
      repositoryRoot: "~/daynights", repositories: [{ remote: "https://github.com/Owner/Repo.git", path: path.join(directory, "daynights", "github.com", "owner", "repo") }],
    });
    expect(await readdir(directory)).toEqual([".daynight"]);
  });

  it("merges unrelated concurrent fields and comments while preserving file permissions", async () => {
    const { context, paths } = await fixture("# settings\npollIntervalMs: 1000 # interval\n");
    if (process.platform !== "win32") await chmod(paths.configFile, 0o640);
    context.prompt = {
      isInteractive: true, select: async () => { throw new Error("Unexpected select"); }, selectMany: async () => { throw new Error("Unexpected selectMany"); }, close: vi.fn(), ask: vi.fn(async () => {
        await writeFile(paths.configFile, "# concurrently edited\npollIntervalMs: 2000 # retained interval\n");
        return "http://localhost:8787";
      }),
    };
    await configure(context, undefined, "server");
    const source = await readFile(paths.configFile, "utf8");
    expect(source).toContain("# concurrently edited");
    expect(source).toContain("# retained interval");
    expect(parseDocument(source).toJS()).toEqual({ pollIntervalMs: 2000, serverUrl: "http://localhost:8787" });
    if (process.platform !== "win32") expect((await lstat(paths.configFile)).mode & 0o777).toBe(0o640);
  });

  it("rejects concurrent changes to the selected field without overwriting them", async () => {
    const { context, paths } = await fixture("serverUrl: http://original:8787\n");
    const concurrent = "serverUrl: http://concurrent:8787\n";
    context.prompt = { isInteractive: true, select: async () => { throw new Error("Unexpected select"); }, selectMany: async () => { throw new Error("Unexpected selectMany"); }, close: vi.fn(), ask: vi.fn(async () => { await writeFile(paths.configFile, concurrent); return "http://requested:8787"; }) };
    await expect(configure(context, undefined, "server")).rejects.toThrow("Configuration changed during setup");
    expect(await readFile(paths.configFile, "utf8")).toBe(concurrent);
    expect(await readdir(paths.stateDirectory)).toEqual(["config.yml"]);
  });

  it.each(["server", "review"] as const)("preserves Copilot settings and their comments during %s setup", async (capability) => {
    const settingsSource = "# Review model\ncopilotModel: future-provider/model-v9 # keep model\ncopilotReasoningEffort: high # keep reasoning effort\n";
    const { context, paths } = await fixture(settingsSource);
    await configure(context, capability === "server" ? { serverUrl: "http://localhost:8787" } : { reviewRepository: { remote: "https://github.com/o/r" } });
    const source = await readFile(paths.configFile, "utf8");
    expect(source).toContain(settingsSource);
    expect(parseDocument(source).toJS().copilotModel).toBe("future-provider/model-v9");
    expect(parseDocument(source).toJS().copilotReasoningEffort).toBe("high");
    expect(await readdir(paths.stateDirectory)).toEqual(["config.yml"]);
  });

  it.each(["null", '""', '" "', "false", '"model\\u0000name"'])("preserves invalid review model configuration without prompting: %s", async (value) => {
    const source = `copilotModel: ${value}\n`;
    const { context, paths } = await fixture(source);
    const ask = answers(context, []);
    await expect(configure(context, undefined, "review")).rejects.toThrow("copilotModel must be a nonempty string without NUL characters");
    expect(ask).not.toHaveBeenCalled();
    expect(await readFile(paths.configFile, "utf8")).toBe(source);
    expect(await readdir(paths.stateDirectory)).toEqual(["config.yml"]);
  });

  it.each(["null", '""', '" "', "false", '"effort\\u0000name"'])("preserves invalid review reasoning effort configuration without prompting: %s", async (value) => {
    const source = `copilotReasoningEffort: ${value}\n`;
    const { context, paths } = await fixture(source);
    const ask = answers(context, []);
    await expect(configure(context, undefined, "review")).rejects.toThrow("copilotReasoningEffort must be a nonempty string without NUL characters");
    expect(ask).not.toHaveBeenCalled();
    expect(await readFile(paths.configFile, "utf8")).toBe(source);
    expect(await readdir(paths.stateDirectory)).toEqual(["config.yml"]);
  });

  it("rejects cancellation after an answer before saving", async () => {
    const { context, paths } = await fixture();
    const cancellation = new AbortController();
    context.prompt = { isInteractive: true, select: async () => { throw new Error("Unexpected select"); }, selectMany: async () => { throw new Error("Unexpected selectMany"); }, close: vi.fn(), ask: vi.fn(async () => { cancellation.abort(); return "http://localhost:8787"; }) };
    await expect(configure(context, undefined, "server", cancellation.signal)).rejects.toThrow("Setup cancelled");
    await expect(lstat(paths.stateDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("explicit flags save both capabilities with one success report and no prompts", async () => {
    const { context, paths } = await fixture();
    const ask = answers(context, []);
    expect(await runCli(["setup", "--server-url", "http://localhost:8787", "--review-repo", "git@github.com:o/r.git"], context)).toBe(0);
    expect(ask).not.toHaveBeenCalled();
    const configuration = parseDocument(await readFile(paths.configFile, "utf8")).toJS();
    expect(configuration.serverUrl).toBe("http://localhost:8787");
    expect(configuration.repositories).toHaveLength(1);
    expect(context.stderr).toHaveBeenCalledExactlyOnceWith(`Configuration saved to ${paths.configFile}.\n`);
  });

  it.each([["setup", "--help"], ["setup", "--review-path", "somewhere"], ["project", "show", "invalid-id"]])("does not prompt for informational or invalid commands %j", async (...args) => {
    const { context, paths } = await fixture();
    const ask = answers(context, []);
    const code = await runCli(args, context);
    expect(code).toBe(args[1] === "--help" ? 0 : 2);
    expect(ask).not.toHaveBeenCalled();
    await expect(lstat(paths.stateDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("resumes the original command once with a fresh operation budget after human input", async () => {
    const { context, paths } = await fixture();
    context.prompt = { isInteractive: true, select: async () => { throw new Error("Unexpected select"); }, selectMany: async () => { throw new Error("Unexpected selectMany"); }, close: vi.fn(), ask: vi.fn(async () => { await new Promise((resolve) => setTimeout(resolve, 40)); return "http://localhost:8787"; }) };
    const command = vi.fn(async ({ operation }) => { operation.check(); return "original command\n"; });
    await runServerCommand(context, command, { operationLimits: { totalMs: 20 } });
    expect(command).toHaveBeenCalledTimes(1);
    expect(context.stdout).toHaveBeenCalledExactlyOnceWith("original command\n");
    expect(await readFile(paths.configFile, "utf8")).toContain("serverUrl");
  });

  it.each(["[invalid YAML", "serverUrl: []\n", "serverUrl: null\n"])("preserves malformed existing configuration without prompting: %s", async (source) => {
    const { context, paths } = await fixture(source);
    const ask = answers(context, []);
    const command = vi.fn(async () => "unexpected");
    await expect(runServerCommand(context, command)).rejects.toThrow();
    expect(ask).not.toHaveBeenCalled();
    expect(command).not.toHaveBeenCalled();
    expect(await readFile(paths.configFile, "utf8")).toBe(source);
  });

  it("keeps saved configuration when the resumed command fails", async () => {
    const { context, paths } = await fixture();
    answers(context, ["http://localhost:8787"]);
    const failure = new Error("Connection refused");
    const command = vi.fn(async () => { throw failure; });
    await expect(runServerCommand(context, command)).rejects.toBe(failure);
    expect(command).toHaveBeenCalledTimes(1);
    expect(parseDocument(await readFile(paths.configFile, "utf8")).toJS()).toEqual({ serverUrl: "http://localhost:8787" });
  });
});

describe("missing configuration classification", () => {
  it("classifies only absent files and directories", async () => {
    const { paths } = await fixture();
    await expect(readConfigurationSource(paths)).rejects.toBeInstanceOf(MissingConfigurationFileError);
    await mkdir(paths.stateDirectory);
    await expect(readConfigurationSource(paths)).rejects.toBeInstanceOf(MissingConfigurationFileError);
  });

  it("retains a file ancestor error", async () => {
    const { paths } = await fixture();
    await writeFile(paths.stateDirectory, "not a directory");
    const nativeFailure = await readFile(paths.configFile, "utf8").catch((cause: unknown) => cause);
    const failure = await readConfigurationSource(paths).catch((cause: unknown) => cause);
    expect(isMissingConfiguration(failure, "serverUrl")).toBe(false);
    expect(nativeFailure).toBeInstanceOf(Error);
    const { code, syscall, path: failedPath } = nativeFailure as NodeJS.ErrnoException;
    expect(failure).toMatchObject({ cause: { code, syscall, path: failedPath } });
  });

  it.skipIf(process.platform === "win32")("retains dangling file and parent symlink errors", async () => {
    const { paths, directory } = await fixture();
    await mkdir(paths.stateDirectory);
    await symlink(path.join(directory, "missing-config"), paths.configFile);
    expect(isMissingConfiguration(await readConfigurationSource(paths).catch((cause: unknown) => cause), "serverUrl")).toBe(false);
    await rm(paths.stateDirectory, { recursive: true });
    await symlink(path.join(directory, "missing-state"), paths.stateDirectory);
    expect(isMissingConfiguration(await readConfigurationSource(paths).catch((cause: unknown) => cause), "serverUrl")).toBe(false);
  });
});
