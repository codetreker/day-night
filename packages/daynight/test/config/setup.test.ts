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
import { parseServerConfiguration } from "../../src/config/server.js";
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
  context.prompt = { isInteractive: true, select: async () => { throw new Error("Unexpected select"); }, selectMany: async () => { throw new Error("Unexpected selectMany"); }, ask, askSecret: vi.fn(async () => ""), close: vi.fn() };
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
      isInteractive: true, select: async () => { throw new Error("Unexpected select"); }, selectMany: async () => { throw new Error("Unexpected selectMany"); }, askSecret: vi.fn(async () => ""), close: vi.fn(), ask: vi.fn(async () => {
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
    context.prompt = { isInteractive: true, select: async () => { throw new Error("Unexpected select"); }, selectMany: async () => { throw new Error("Unexpected selectMany"); }, askSecret: vi.fn(async () => ""), close: vi.fn(), ask: vi.fn(async () => { await writeFile(paths.configFile, concurrent); return "http://requested:8787"; }) };
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
    context.prompt = { isInteractive: true, select: async () => { throw new Error("Unexpected select"); }, selectMany: async () => { throw new Error("Unexpected selectMany"); }, askSecret: vi.fn(async () => ""), close: vi.fn(), ask: vi.fn(async () => { cancellation.abort(); return "http://localhost:8787"; }) };
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
    context.prompt = { isInteractive: true, select: async () => { throw new Error("Unexpected select"); }, selectMany: async () => { throw new Error("Unexpected selectMany"); }, askSecret: vi.fn(async () => ""), close: vi.fn(), ask: vi.fn(async () => { await new Promise((resolve) => setTimeout(resolve, 40)); return "http://localhost:8787"; }) };
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

describe("server token setup transactions", () => {
  it.each([
    ["--server-token=argv-secret"], ["--server-token", "argv-secret"],
    ["--server-token-stdin=argv-secret"], ["--server-token-stdin", "argv-secret"],
  ])("rejects token values in argv without revealing them: %j", async (...arguments_) => {
    const { context, paths } = await fixture();
    const ask = answers(context, []);
    context.readStdin = vi.fn(async () => "unread-secret");
    expect(await runCli(["setup", ...arguments_], context)).toBe(2);
    expect(JSON.stringify(vi.mocked(context.stderr).mock.calls)).not.toContain("argv-secret");
    expect(context.stdout).not.toHaveBeenCalled();
    expect(ask).not.toHaveBeenCalled();
    expect(context.prompt!.askSecret).not.toHaveBeenCalled();
    expect(context.readStdin).not.toHaveBeenCalled();
    await expect(lstat(paths.stateDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("documents token stdin as a boolean setup flag", async () => {
    const { context } = await fixture();
    expect(await runCli(["setup", "--help"], context)).toBe(0);
    const output = vi.mocked(context.stdout).mock.calls.map(([text]) => text).join("");
    expect(output).toContain("--server-token-stdin");
    expect(output).not.toMatch(/--server-token-stdin\s+<[^>]+>/);
  });

  it.each(["stdin-secret", "stdin-secret\n", "stdin-secret\r\n"])("reads one token line from explicit stdin without prompting: %j", async (input) => {
    const { context, paths } = await fixture();
    const ask = answers(context, []);
    context.readStdin = vi.fn(async () => input);
    expect(await runCli(["setup", "--server-url", "http://127.0.0.1:8787", "--server-token-stdin"], context)).toBe(0);
    expect(parseDocument(await readFile(paths.configFile, "utf8")).toJS()).toEqual({ serverUrl: "http://127.0.0.1:8787", serverToken: "stdin-secret" });
    expect(ask).not.toHaveBeenCalled();
    expect(context.prompt!.askSecret).not.toHaveBeenCalled();
    expect(context.readStdin).toHaveBeenCalledExactlyOnceWith(expect.any(AbortSignal));
    expect(JSON.stringify(vi.mocked(context.stderr).mock.calls)).not.toContain("stdin-secret");
    expect(context.stdout).not.toHaveBeenCalled();
    if (process.platform !== "win32") expect((await lstat(paths.configFile)).mode & 0o777).toBe(0o600);
  });

  it("reuses the configured origin for explicit token input", async () => {
    const { context, paths } = await fixture("serverUrl: https://service.example\n");
    context.readStdin = vi.fn(async () => "replacement-secret");
    const ask = answers(context, []);
    await configure(context, { serverTokenStdin: true });
    expect(parseDocument(await readFile(paths.configFile, "utf8")).toJS()).toEqual({ serverUrl: "https://service.example", serverToken: "replacement-secret" });
    expect(ask).not.toHaveBeenCalled();
    expect(context.prompt!.askSecret).not.toHaveBeenCalled();
  });

  it("requires a server URL before consuming token stdin on a fresh home", async () => {
    const { context, paths } = await fixture();
    context.readStdin = vi.fn(async () => "unread-secret");
    const ask = answers(context, []);
    await expect(configure(context, { serverTokenStdin: true })).rejects.toThrow("--server-url");
    expect(context.readStdin).not.toHaveBeenCalled();
    expect(ask).not.toHaveBeenCalled();
    await expect(lstat(paths.stateDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["", "\n", "\r\n", "secret\nsecond", "secret\n\n", "secret\r", "secret\tvalue", "secret value", "secret\u0000value", "secret\u007fvalue", "secret\u0080value"])("rejects invalid token stdin atomically without leaking its bytes: %j", async (input) => {
    const original = "# untouched\nserverUrl: https://service.example\nserverToken: old-secret\n";
    const { context, paths } = await fixture(original);
    context.readStdin = vi.fn(async () => input);
    expect(await runCli(["setup", "--server-token-stdin"], context)).toBe(1);
    expect(await readFile(paths.configFile, "utf8")).toBe(original);
    expect(await readdir(paths.stateDirectory)).toEqual(["config.yml"]);
    const diagnostic = JSON.stringify(vi.mocked(context.stderr).mock.calls);
    expect(diagnostic).toContain("serverToken");
    expect(diagnostic).not.toContain("old-secret");
    if (input.startsWith("secret")) expect(diagnostic).not.toContain("secret");
    expect(context.stdout).not.toHaveBeenCalled();
  });

  it("keeps the original file if stdin reading fails", async () => {
    const original = "serverUrl: https://service.example\nserverToken: old-secret\n";
    const { context, paths } = await fixture(original);
    const failure = new Error("Input failed");
    context.readStdin = vi.fn(async () => { throw failure; });
    await expect(configure(context, { serverTokenStdin: true })).rejects.toBe(failure);
    expect(await readFile(paths.configFile, "utf8")).toBe(original);
  });

  it("rejects insecure token transport before saving without revealing the token", async () => {
    const { context, paths } = await fixture();
    context.readStdin = vi.fn(async () => "transport-secret");
    expect(await runCli(["setup", "--server-url", "http://service.example", "--server-token-stdin"], context)).toBe(1);
    expect(JSON.stringify(vi.mocked(context.stderr).mock.calls)).not.toContain("transport-secret");
    await expect(lstat(paths.stateDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("always asks for a hidden token in interactive server setup and retries invalid input", async () => {
    const { context, paths } = await fixture();
    answers(context, ["https://service.example"]);
    const askSecret = vi.fn().mockResolvedValueOnce("invalid secret").mockResolvedValueOnce("valid-secret");
    context.prompt!.askSecret = askSecret;
    await configure(context, undefined, "server");
    expect(askSecret).toHaveBeenCalledTimes(2);
    expect(askSecret).toHaveBeenCalledWith("Server token (hidden; blank to skip): ", expect.any(AbortSignal));
    expect(parseDocument(await readFile(paths.configFile, "utf8")).toJS()).toEqual({ serverUrl: "https://service.example", serverToken: "valid-secret" });
    expect(JSON.stringify(vi.mocked(context.stderr).mock.calls)).not.toContain("invalid secret");
    expect(JSON.stringify(vi.mocked(context.stderr).mock.calls)).not.toContain("valid-secret");
  });

  it.each([
    undefined,
    "serverUrl: http://service.example\n",
    "serverUrl: https://previous.example\nserverToken: previous-secret\n",
  ])("discards a rejected interactive token when the next answer skips token setup: %j", async (original) => {
    const { context, paths } = await fixture(original);
    answers(context, ["http://service.example"]);
    const secret = "rejected-transport-secret";
    const askSecret = vi.fn().mockResolvedValueOnce(secret).mockResolvedValueOnce("");
    context.prompt!.askSecret = askSecret;
    await configure(context, undefined, "server");
    const source = await readFile(paths.configFile, "utf8");
    expect(askSecret).toHaveBeenCalledTimes(2);
    expect(parseDocument(source).toJS()).toEqual({ serverUrl: "http://service.example" });
    expect(parseServerConfiguration(source, paths)).toEqual({ serverUrl: "http://service.example" });
    const diagnostic = JSON.stringify(vi.mocked(context.stderr).mock.calls);
    expect(diagnostic).toContain("HTTPS");
    expect(diagnostic).not.toContain(secret);
    expect(diagnostic).not.toContain("previous-secret");
    expect(context.stdout).not.toHaveBeenCalled();
  });

  it("fails when an interactive prompt cannot read a secret", async () => {
    const { context, paths } = await fixture();
    const ask = answers(context, ["https://service.example"]);
    delete context.prompt!.askSecret;
    await expect(configure(context, undefined, "server")).rejects.toThrow();
    expect(ask).toHaveBeenCalledTimes(1);
    await expect(lstat(paths.stateDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves a token for the normalized same origin when the hidden answer is blank", async () => {
    const { context, paths } = await fixture("serverUrl: https://service.example\nserverToken: retained-secret\n");
    answers(context, ["HTTPS://SERVICE.EXAMPLE:443/"]);
    await configure(context, undefined, "server");
    expect(context.prompt!.askSecret).toHaveBeenCalledWith("Server token (hidden; blank to keep current token): ", expect.any(AbortSignal));
    expect(parseDocument(await readFile(paths.configFile, "utf8")).toJS()).toEqual({ serverUrl: "https://service.example", serverToken: "retained-secret" });
  });

  it.each([false, true])("clears a token when the origin changes unless a replacement is supplied: replacement=%s", async (replace) => {
    const { context, paths } = await fixture("serverUrl: https://old.example\nserverToken: old-secret\n");
    answers(context, ["https://replacement.example"]);
    context.prompt!.askSecret = vi.fn(async () => replace ? "replacement-secret" : "");
    await configure(context, undefined, "server");
    expect(context.prompt!.askSecret).toHaveBeenCalledWith("Server token (hidden; blank to skip): ", expect.any(AbortSignal));
    expect(parseDocument(await readFile(paths.configFile, "utf8")).toJS()).toEqual({ serverUrl: "https://replacement.example", ...(replace ? { serverToken: "replacement-secret" } : {}) });
  });

  it("preserves same-origin tokens for URL flags and clears them for changed origins without prompting", async () => {
    const { context, paths } = await fixture("serverUrl: https://service.example\nserverToken: retained-secret\n");
    answers(context, []);
    await configure(context, { serverUrl: "HTTPS://SERVICE.EXAMPLE:443/" });
    expect(parseDocument(await readFile(paths.configFile, "utf8")).toJS()).toEqual({ serverUrl: "https://service.example", serverToken: "retained-secret" });
    await configure(context, { serverUrl: "https://replacement.example" });
    expect(parseDocument(await readFile(paths.configFile, "utf8")).toJS()).toEqual({ serverUrl: "https://replacement.example" });
    expect(context.prompt!.askSecret).not.toHaveBeenCalled();
  });

  it("rejects a concurrent token edit when server setup is selected", async () => {
    const { context, paths } = await fixture("serverUrl: https://service.example\nserverToken: original-secret\n");
    answers(context, ["https://service.example"]);
    const concurrent = "serverUrl: https://service.example\nserverToken: concurrent-secret\n";
    context.prompt!.askSecret = vi.fn(async () => { await writeFile(paths.configFile, concurrent); return "requested-secret"; });
    await expect(configure(context, undefined, "server")).rejects.toThrow("Configuration changed during setup");
    expect(await readFile(paths.configFile, "utf8")).toBe(concurrent);
    expect(await readdir(paths.stateDirectory)).toEqual(["config.yml"]);
  });

  it("preserves concurrent review changes during token-only setup", async () => {
    const { context, paths, directory } = await fixture("serverUrl: https://service.example\nserverToken: original-secret\n");
    const reviewPath = path.join(directory, "review");
    context.readStdin = vi.fn(async () => {
      await writeFile(paths.configFile, `# concurrent review registration\nserverUrl: https://service.example\nserverToken: original-secret\nrepositories:\n  - remote: https://github.com/owner/repo.git\n    path: ${JSON.stringify(reviewPath)}\n`);
      return "replacement-secret";
    });
    await configure(context, { serverTokenStdin: true });
    const source = await readFile(paths.configFile, "utf8");
    expect(source).toContain("# concurrent review registration");
    expect(parseDocument(source).toJS()).toEqual({ serverUrl: "https://service.example", serverToken: "replacement-secret", repositories: [{ remote: "https://github.com/owner/repo.git", path: reviewPath }] });
  });

  it("preserves a concurrent token change during review-only setup", async () => {
    const { context, paths } = await fixture("serverUrl: https://service.example\nserverToken: original-secret\n");
    answers(context, []);
    context.prompt!.ask = vi.fn().mockImplementationOnce(async () => {
      await writeFile(paths.configFile, "# concurrent credential update\nserverUrl: https://service.example\nserverToken: concurrent-secret\n");
      return "https://github.com/owner/repo.git";
    }).mockResolvedValueOnce("");
    await configure(context, undefined, "review");
    const source = await readFile(paths.configFile, "utf8");
    expect(source).toContain("# concurrent credential update");
    expect(parseDocument(source).toJS()).toMatchObject({ serverUrl: "https://service.example", serverToken: "concurrent-secret", repositories: [{ remote: "https://github.com/owner/repo.git" }] });
  });

  it("leaves the original configuration unchanged when cancelled at the secret prompt", async () => {
    const original = "# original\nserverUrl: https://service.example\nserverToken: original-secret\n";
    const { context, paths } = await fixture(original);
    answers(context, ["https://replacement.example"]);
    context.prompt!.askSecret = vi.fn(async () => { throw new CliCancelledError(); });
    await expect(configure(context, undefined, "server")).rejects.toBeInstanceOf(CliCancelledError);
    expect(await readFile(paths.configFile, "utf8")).toBe(original);
    expect(await readdir(paths.stateDirectory)).toEqual(["config.yml"]);
  });

  it.skipIf(process.platform === "win32")("restricts an existing token-bearing file when unrelated review data is saved", async () => {
    const { context, paths } = await fixture("serverUrl: https://service.example\nserverToken: retained-secret\n");
    await chmod(paths.configFile, 0o640);
    await configure(context, { reviewRepository: { remote: "https://github.com/owner/repo.git" } });
    expect((await lstat(paths.configFile)).mode & 0o777).toBe(0o600);
    expect(parseDocument(await readFile(paths.configFile, "utf8")).toJS()).toMatchObject({ serverToken: "retained-secret" });
  });

  it.skipIf(process.platform === "win32")("rejects a token write through a symlink without modifying its target", async () => {
    const { context, paths, directory } = await fixture();
    await mkdir(paths.stateDirectory);
    const target = path.join(directory, "target.yml");
    const original = "serverUrl: https://service.example\n";
    await writeFile(target, original);
    await symlink(target, paths.configFile);
    context.readStdin = vi.fn(async () => "replacement-secret");
    await expect(configure(context, { serverTokenStdin: true })).rejects.toThrow("symbolic-link");
    expect(await readFile(target, "utf8")).toBe(original);
    expect((await lstat(paths.configFile)).isSymbolicLink()).toBe(true);
    expect(await readdir(paths.stateDirectory)).toEqual(["config.yml"]);
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
