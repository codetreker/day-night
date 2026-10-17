import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
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

  it("validates configuration using an injected current-user home and reports the unimplemented coordinator", async () => {
    const deps = dependencies();
    deps.homeDirectory = () => fileURLToPath(new URL("../../../.tmp/CLI User 用户/", import.meta.url));
    deps.loadConfiguration = vi.fn(async (paths) => parseConfiguration("repositories: [{remote: https://github.com/o/r, path: ../repo}]", paths));
    expect(await runCli(["--deamon-review"], deps)).toBe(1);
    expect(deps.loadConfiguration).toHaveBeenCalledOnce();
    expect(deps.errors.join("")).toContain("review coordinator is not implemented");
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
});
