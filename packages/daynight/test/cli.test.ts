import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { parseDocument } from "yaml";
import { formatError, runCli } from "../src/cli.js";
import type { CliDependencies } from "../src/cli.js";
import { parseConfiguration } from "../src/config.js";
import { resolveRuntimePaths } from "../src/paths.js";

const dependencies = (): CliDependencies & { output: string[]; errors: string[] } => {
  const output: string[] = [];
  const errors: string[] = [];
  return {
    version: "1.2.3",
    homeDirectory: () => { throw new Error("Home must not be read for informational commands."); },
    workingDirectory: () => { throw new Error("Working directory must not be read for informational commands."); },
    addRepository: async () => { throw new Error("Repositories must not be added for informational commands."); },
    loadConfiguration: async () => { throw new Error("Configuration must not be loaded for informational commands."); },
    runReview: async () => { throw new Error("Review must not run for informational commands."); },
    stdout: (text) => { output.push(text); },
    stderr: (text) => { errors.push(text); },
    output,
    errors,
  };
};

describe("CLI argument handling", () => {
  it.each(["--help", "-h"])("prints %s without touching configuration or user state", async (argument) => {
    const deps = dependencies();
    expect(await runCli([argument], deps)).toBe(0);
    expect(deps.output.join("")).toContain("daynight --daemon-review");
    expect(deps.errors).toEqual([]);
  });

  it.each(["--version", "-v"])("prints %s without touching configuration", async (argument) => {
    const deps = dependencies();
    expect(await runCli([argument], deps)).toBe(0);
    expect(deps.output).toEqual(["1.2.3\n"]);
  });

  it.each(["--help", "-h"])("prints add-repo %s without inspecting user directories", async (argument) => {
    const deps = dependencies();
    expect(await runCli(["add-repo", argument], deps)).toBe(0);
    expect(deps.output.join("")).toContain("Usage: daynight add-repo <remote> [--path <path>]");
    expect(deps.output.join("")).toContain("~/daynights");
    expect(deps.errors).toEqual([]);
  });

  it.each([{ args: [] }, { args: ["--deamon-review"] }, { args: ["--config", "custom.yml"] }, { args: ["--help", "--daemon-review"] }])("rejects missing, unknown or conflicting arguments", async ({ args }) => {
    const deps = dependencies();
    expect(await runCli(args, deps)).toBe(2);
    expect(deps.errors.join("")).toContain("daynight --help");
    expect(deps.output).toEqual([]);
  });

  it.each([
    ["add-repo"],
    ["add-repo", ""],
    ["add-repo", "https://github.com/o/r", "other"],
    ["add-repo", "https://github.com/o/r", "--path"],
    ["add-repo", "https://github.com/o/r", "--path", ""],
    ["add-repo", "https://github.com/o/r", "--path", "--help"],
    ["add-repo", "https://github.com/o/r", "--path", "a", "--path", "b"],
    ["add-repo", "https://github.com/o/r", "--daemon-review"],
    ["add-repo", "--unknown"],
  ])("rejects invalid add-repo syntax %j before touching user state", async (...args) => {
    const deps = dependencies();
    expect(await runCli(args, deps)).toBe(2);
    expect(deps.errors.join("")).toContain("daynight --help");
    expect(deps.errors.join("")).not.toContain("informational commands");
    expect(deps.output).toEqual([]);
  });

  it.each([
    { args: ["add-repo", "https://github.com/o/r"], input: { remote: "https://github.com/o/r" }, added: true },
    { args: ["add-repo", "https://github.com/o/r", "--path", "./review"], input: { remote: "https://github.com/o/r", path: "./review" }, added: true },
    { args: ["add-repo", "--path", "./review", "https://github.com/o/r"], input: { remote: "https://github.com/o/r", path: "./review" }, added: false },
  ])("dispatches configuration-only additions with caller directories: $args", async ({ args, input, added }) => {
    const deps = dependencies();
    const home = fileURLToPath(new URL("../../../.tmp/CLI User 用户/", import.meta.url));
    const cwd = path.join(home, "caller");
    const repository = parseConfiguration("repositories: [{remote: https://github.com/o/r, path: ../review}]", resolveRuntimePaths(home)).repositories[0]!;
    deps.homeDirectory = () => home;
    deps.workingDirectory = () => cwd;
    deps.addRepository = vi.fn(async () => ({ repository, added }));
    expect(await runCli(args, deps)).toBe(0);
    expect(deps.addRepository).toHaveBeenCalledExactlyOnceWith(input, resolveRuntimePaths(home), { homeDirectory: home, workingDirectory: cwd });
    expect(deps.output.join("")).toContain(added ? "Repository github.com/o/r added." : "Repository github.com/o/r is already configured.");
    expect(deps.output.join("")).toContain(`Path: ${repository.path}`);
    expect(deps.output.join("")).toContain("next time daynight --daemon-review starts");
    expect(deps.errors).toEqual([]);
  });

  it("retains configuration-write failure context and reports no successful addition", async () => {
    const deps = dependencies();
    deps.homeDirectory = () => path.resolve(".tmp", "write failure");
    deps.workingDirectory = () => path.resolve(".tmp");
    deps.addRepository = async () => { throw new Error("Cannot save configuration", { cause: new Error("Disk full") }); };
    expect(await runCli(["add-repo", "https://github.com/o/r"], deps)).toBe(1);
    expect(deps.errors.join("")).toContain("Cannot save configuration\nCaused by: Disk full");
    expect(deps.output).toEqual([]);
  });

  it("runs the foreground coordinator using the resolved current-user configuration", async () => {
    const deps = dependencies();
    deps.homeDirectory = () => fileURLToPath(new URL("../../../.tmp/CLI User 用户/", import.meta.url));
    deps.loadConfiguration = vi.fn(async (paths) => parseConfiguration("repositories: [{remote: https://github.com/o/r, path: ../repo}]", paths));
    deps.runReview = vi.fn(async () => {});
    expect(await runCli(["--daemon-review"], deps)).toBe(0);
    expect(deps.loadConfiguration).toHaveBeenCalledOnce();
    expect(deps.runReview).toHaveBeenCalledWith(expect.objectContaining({ maxConcurrentWorker: 1 }), expect.objectContaining({ configFile: expect.stringContaining("config.yml") }));
    expect(deps.errors).toEqual([]);
    expect(deps.output).toEqual([]);
  });

  it("reports original configuration failure context and never prints a success diagnostic", async () => {
    const deps = dependencies();
    deps.homeDirectory = () => fileURLToPath(new URL("../../../.tmp/CLI User 用户/", import.meta.url));
    deps.loadConfiguration = async () => { throw new Error("Cannot read configuration", { cause: new Error("ENOENT: missing config.yml") }); };
    expect(await runCli(["--daemon-review"], deps)).toBe(1);
    expect(deps.errors.join("")).toContain("Caused by: ENOENT");
    expect(deps.errors.join("")).not.toContain("Configuration is valid");
  });

  it("reports a foreground runtime failure with its original cause", async () => {
    const deps = dependencies();
    deps.homeDirectory = () => fileURLToPath(new URL("../../../.tmp/CLI User 用户/", import.meta.url));
    deps.loadConfiguration = async (paths) => parseConfiguration("repositories: [{remote: https://github.com/o/r, path: ../repo}]", paths);
    deps.runReview = async () => { throw new Error("Cannot start reviews", { cause: new Error("Instance lock is held") }); };
    expect(await runCli(["--daemon-review"], deps)).toBe(1);
    expect(deps.errors.join("")).toContain("Cannot start reviews\nCaused by: Instance lock is held");
  });

  it("preserves nested and aggregate error diagnostics", () => {
    expect(formatError(new Error("outer", { cause: new AggregateError([new Error("first"), new Error("second")], "invalid YAML") }))).toBe("outer\nCaused by: invalid YAML\nfirst\nsecond");
  });
});

describe("built executable", () => {
  const executable = fileURLToPath(new URL("../dist/main.js", import.meta.url));

  it("retains the Node shebang and produces help from an unrelated working directory", async () => {
    expect((await readFile(executable, "utf8")).startsWith("#!/usr/bin/env node\n")).toBe(true);
    const result = spawnSync(process.execPath, [executable, "--help"], {
      cwd: fileURLToPath(new URL("../../../", import.meta.url)),
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage: daynight --daemon-review");
    expect(result.stderr).toBe("");
  });

  it("prints the package version from the installed manifest", async () => {
    const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    const result = spawnSync(process.execPath, [executable, "--version"], { encoding: "utf8", timeout: 10_000 });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${manifest.version}\n`);
    expect(result.stderr).toBe("");
  });

  it("rejects the misspelled review option and shows the supported spelling", () => {
    const result = spawnSync(process.execPath, [executable, "--deamon-review"], { encoding: "utf8", timeout: 10_000 });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("--daemon-review");
  });

  it("adds repositories through the compiled CLI without review dependencies or runtime state", async () => {
    const temporary = fileURLToPath(new URL("../../../.tmp/", import.meta.url));
    await mkdir(temporary, { recursive: true });
    const directory = await mkdtemp(path.join(temporary, "add-repo CLI 中文-"));
    const home = path.join(directory, "home 中文");
    const cwd = path.join(directory, "caller 中文");
    const emptyPath = path.join(directory, "empty-path");
    await mkdir(home); await mkdir(cwd); await mkdir(emptyPath);
    const paths = resolveRuntimePaths(home);
    const invoke = (args: string[]) => spawnSync(process.execPath, [executable, ...args], {
      cwd, encoding: "utf8", timeout: 10_000,
      env: { ...process.env, HOME: home, USERPROFILE: home, PATH: emptyPath, Path: emptyPath },
    });
    try {
      const first = invoke(["add-repo", "https://github.com/Owner/Repo.git"]);
      expect(first.error).toBeUndefined();
      expect(first.status, first.stderr).toBe(0);
      expect(first.stdout).toContain("Repository github.com/owner/repo added.");
      expect(first.stderr).toBe("");
      const initial = parseDocument(await readFile(paths.configFile, "utf8"));
      expect(initial.get("repositoryRoot")).toBe("~/daynights");
      const firstPath = path.join(home, "daynights", "github.com", "owner", "repo");
      expect(initial.toJS().repositories).toEqual([{ remote: "https://github.com/Owner/Repo.git", path: firstPath }]);
      expect(await readdir(paths.stateDirectory)).toEqual(["config.yml"]);
      expect(await readdir(home)).toEqual([".daynight"]);

      initial.set("repositoryRoot", "../new root 中文");
      await writeFile(paths.configFile, initial.toString());
      await writeFile(paths.lockFile, "existing review instance\n");
      const second = invoke(["add-repo", "git@github.com:Owner/Other.git"]);
      expect(second.status, second.stderr).toBe(0);
      const third = invoke(["add-repo", "https://github.com/owner/explicit", "--path", "./explicit review 中文"]);
      expect(third.status, third.stderr).toBe(0);
      const after = parseDocument(await readFile(paths.configFile, "utf8")).toJS();
      expect(after.repositories.map((repository: { path: string }) => repository.path)).toEqual([
        firstPath,
        path.join(home, "new root 中文", "github.com", "owner", "other"),
        path.join(cwd, "explicit review 中文"),
      ]);
      const source = await readFile(paths.configFile, "utf8");
      const repeated = invoke(["add-repo", "https://GITHUB.COM/owner/repo", "--path", firstPath]);
      expect(repeated.status, repeated.stderr).toBe(0);
      expect(repeated.stdout).toContain("is already configured");
      expect(await readFile(paths.configFile, "utf8")).toBe(source);
      const repeatedDefault = invoke(["add-repo", "git@github.com:OWNER/REPO.git"]);
      expect(repeatedDefault.status, repeatedDefault.stderr).toBe(0);
      expect(repeatedDefault.stdout).toContain(`Path: ${firstPath}`);
      expect(await readFile(paths.configFile, "utf8")).toBe(source);
      const conflict = invoke(["add-repo", "https://github.com/owner/repo", "--path", "./wrong"]);
      expect(conflict.status).toBe(1);
      expect(conflict.stdout).toBe("");
      expect(await readFile(paths.configFile, "utf8")).toBe(source);
      const invalid = invoke(["add-repo", "https://github.com/owner/invalid", "--path"]);
      expect(invalid.status).toBe(2);
      expect(await readFile(paths.configFile, "utf8")).toBe(source);
      expect(await readFile(paths.lockFile, "utf8")).toBe("existing review instance\n");
      expect((await readdir(paths.stateDirectory)).sort()).toEqual(["config.yml", "instance.lock"]);
      expect(await readdir(cwd)).toEqual([]);
      expect(await readdir(home)).toEqual([".daynight"]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 30_000);

  it("runs the compiled foreground entry with fixed home paths until a shutdown signal", async () => {
    const temporary = fileURLToPath(new URL("../../../.tmp/", import.meta.url));
    await mkdir(temporary, { recursive: true });
    const directory = await mkdtemp(path.join(temporary, "compiled-cli 用户-"));
    const state = path.join(directory, ".daynight");
    const emptyPath = path.join(directory, "empty-path");
    await mkdir(state); await mkdir(emptyPath);
    await writeFile(path.join(state, "config.yml"), "pollIntervalMs: 50\nrepositories: [{remote: https://github.com/o/r, path: ../repository}]\n");
    const harness = path.join(directory, "shutdown.mjs");
    await writeFile(harness, `import { existsSync } from 'node:fs';
const timeout = setTimeout(() => { throw new Error('Foreground startup timed out'); }, 10000);
const probe = setInterval(() => {
  if (!existsSync(${JSON.stringify(path.join(state, "state.sqlite"))})) return;
  clearInterval(probe); clearTimeout(timeout);
  setTimeout(() => process.emit('SIGINT'), 100);
}, 10);
`);
    try {
      const result = spawnSync(process.execPath, ["--import", pathToFileURL(harness).href, executable, "--daemon-review"], {
        cwd: directory, encoding: "utf8", timeout: 15_000,
        env: { ...process.env, HOME: directory, USERPROFILE: directory, PATH: emptyPath, Path: emptyPath },
      });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toContain("Foreground review started");
      expect(result.stderr).toContain(state);
      await expect(readFile(path.join(state, "instance.lock"))).rejects.toMatchObject({ code: "ENOENT" });
      expect((await readFile(path.join(state, "state.sqlite"))).length).toBeGreaterThan(0);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 20_000);
});
