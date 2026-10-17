import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { formatError, runCli } from "../src/cli.js";
import type { CliDependencies } from "../src/cli.js";
import { parseConfiguration } from "../src/config.js";

const dependencies = (): CliDependencies & { output: string[]; errors: string[] } => {
  const output: string[] = [];
  const errors: string[] = [];
  return {
    version: "1.2.3",
    homeDirectory: () => { throw new Error("Home must not be read for informational commands."); },
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
    expect(deps.output.join("")).toContain("daynight --deamon-review");
    expect(deps.errors).toEqual([]);
  });

  it.each(["--version", "-v"])("prints %s without touching configuration", async (argument) => {
    const deps = dependencies();
    expect(await runCli([argument], deps)).toBe(0);
    expect(deps.output).toEqual(["1.2.3\n"]);
  });

  it.each([{ args: [] }, { args: ["--daemon-review"] }, { args: ["--config", "custom.yml"] }, { args: ["--help", "--deamon-review"] }])("rejects missing, unknown or conflicting arguments", async ({ args }) => {
    const deps = dependencies();
    expect(await runCli(args, deps)).toBe(2);
    expect(deps.errors.join("")).toContain("daynight --help");
    expect(deps.output).toEqual([]);
  });

  it("runs the foreground coordinator using the resolved current-user configuration", async () => {
    const deps = dependencies();
    deps.homeDirectory = () => fileURLToPath(new URL("../../../.tmp/CLI User 用户/", import.meta.url));
    deps.loadConfiguration = vi.fn(async (paths) => parseConfiguration("repositories: [{remote: https://github.com/o/r, path: ../repo}]", paths));
    deps.runReview = vi.fn(async () => {});
    expect(await runCli(["--deamon-review"], deps)).toBe(0);
    expect(deps.loadConfiguration).toHaveBeenCalledOnce();
    expect(deps.runReview).toHaveBeenCalledWith(expect.objectContaining({ maxConcurrentWorker: 1 }), expect.objectContaining({ configFile: expect.stringContaining("config.yml") }));
    expect(deps.errors).toEqual([]);
    expect(deps.output).toEqual([]);
  });

  it("reports original configuration failure context and never prints a success diagnostic", async () => {
    const deps = dependencies();
    deps.homeDirectory = () => fileURLToPath(new URL("../../../.tmp/CLI User 用户/", import.meta.url));
    deps.loadConfiguration = async () => { throw new Error("Cannot read configuration", { cause: new Error("ENOENT: missing config.yml") }); };
    expect(await runCli(["--deamon-review"], deps)).toBe(1);
    expect(deps.errors.join("")).toContain("Caused by: ENOENT");
    expect(deps.errors.join("")).not.toContain("Configuration is valid");
  });

  it("reports a foreground runtime failure with its original cause", async () => {
    const deps = dependencies();
    deps.homeDirectory = () => fileURLToPath(new URL("../../../.tmp/CLI User 用户/", import.meta.url));
    deps.loadConfiguration = async (paths) => parseConfiguration("repositories: [{remote: https://github.com/o/r, path: ../repo}]", paths);
    deps.runReview = async () => { throw new Error("Cannot start reviews", { cause: new Error("Instance lock is held") }); };
    expect(await runCli(["--deamon-review"], deps)).toBe(1);
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
    expect(result.stdout).toContain("Usage: daynight --deamon-review");
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

  it("returns an actionable nonzero failure for an unknown argument", () => {
    const result = spawnSync(process.execPath, [executable, "--daemon-review"], { encoding: "utf8", timeout: 10_000 });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("--deamon-review");
  });

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
      const result = spawnSync(process.execPath, ["--import", pathToFileURL(harness).href, executable, "--deamon-review"], {
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
