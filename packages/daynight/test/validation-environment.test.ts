import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import crossSpawn from "cross-spawn";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createValidationProbeRecorder } from "../scripts/validation-environment.js";

const temporary = path.resolve(import.meta.dirname, "../../../.tmp/validation-probe-tests");
const directories: string[] = [];
type Diagnostics = {
  error: null | { name: string; message: string; code?: string; syscall?: string };
  probes: {
    file: string; args: string[]; state: string; resolvedExecutable: string | null; launcher: string | null;
    startedAt: string; elapsedMs: number; timeoutMs: number; maxBuffer: number; exitCode: number | null;
    stdout: string; stderr: string; stdoutTruncated: boolean; stderrTruncated: boolean;
    error: null | { name: string; message: string; code?: string; syscall?: string };
  }[];
};
const fixture = () => {
  mkdirSync(temporary, { recursive: true });
  const directory = mkdtempSync(path.join(temporary, "Probe 中文 "));
  directories.push(directory);
  const bin = path.join(directory, "bin");
  mkdirSync(bin);
  const inheritedPathKey = Object.keys(process.env).find((key) => key.toLowerCase() === "path");
  if (inheritedPathKey === undefined) throw new Error("Native probe tests require PATH.");
  const environment: NodeJS.ProcessEnv = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "path")),
    PATH: `${bin}${path.delimiter}${process.env[inheritedPathKey]}`,
    DAYNIGHT_PROBE_NODE: process.execPath,
  };
  const tool = (name: string, source: string, extension = ".cmd"): string => {
    const script = path.join(bin, `${name}${extension}.cjs`);
    writeFileSync(script, source);
    const executable = path.join(bin, process.platform === "win32" ? `${name}${extension}` : name);
    const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
    // Keep batch source ASCII; CMD expands the Unicode directory from the invoked shim.
    const wrapper = process.platform === "win32"
      ? `@echo off\r\n"%DAYNIGHT_PROBE_NODE%" "%~dp0${path.basename(script)}" %*\r\n`
      : `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(script)} "$@"\n`;
    if (process.platform === "win32") expect(wrapper).toMatch(/^[\x00-\x7f]*$/);
    writeFileSync(executable, wrapper);
    chmodSync(executable, 0o755);
    return executable;
  };
  const diagnostics = path.join(directory, "evidence");
  const read = (): Diagnostics => JSON.parse(readFileSync(path.join(diagnostics, "validation-probes.json"), "utf8")) as Diagnostics;
  const log: string[] = [];
  const recorder = () => createValidationProbeRecorder({ directory: diagnostics, environment, log: (message) => { log.push(message); } });
  return { directory, bin, environment, tool, diagnostics, read, log, recorder };
};
afterEach(({ task }) => {
  for (const directory of directories.splice(0)) {
    try {
      if (task.result?.state === "fail") {
        for (const relative of ["evidence/validation-probes.json", ".tmp/validation-probes.json"]) {
          const diagnostics = path.join(directory, relative);
          if (existsSync(diagnostics)) process.stderr.write(`Native probe fixture failure (${task.name}): ${readFileSync(diagnostics, "utf8").slice(0, 65_536)}\n`);
        }
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
});

describe("native validation environment probes", () => {
  it("persists and streams command identity before launch and completed evidence before returning", () => {
    const f = fixture();
    let executions = 0;
    const recorder = createValidationProbeRecorder({ directory: f.diagnostics, environment: f.environment,
      log: (message) => { f.log.push(message); },
      execute: (file, args, options) => {
        const pending = f.read().probes.at(-1)!;
        expect(pending.state).toBe("running");
        expect(pending.resolvedExecutable).toBe(process.execPath);
        expect(pending.launcher).toBe(process.execPath);
        expect(options).toMatchObject({ timeout: 10_000, maxBuffer: 1_048_576, shell: false, windowsHide: true, encoding: "utf8" });
        executions += 1;
        return crossSpawn.sync(file, args, options);
      },
    });
    expect(f.read().probes).toEqual([]);
    expect(recorder.command(process.execPath, ["-e", "process.stdout.write(' first\\nsecond \\n')"])).toBe("first\nsecond");
    expect(recorder.version(process.execPath)).toBe(process.version);
    expect(executions).toBe(2);
    expect(f.read().probes.map((probe) => probe.state)).toEqual(["completed", "completed"]);
    expect(f.read().error).toBeNull();
    expect(f.log.map((message) => JSON.parse(message.slice("Validation probe: ".length)).state)).toEqual([
      "resolving", "running", "completed", "resolving", "running", "completed",
    ]);
    expect(f.read().probes[0]!.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(Date.parse(f.read().probes[0]!.startedAt))).toBe(false);
  });

  it("saves nonzero results and both output streams before propagating failure", () => {
    const f = fixture();
    expect(() => f.recorder().command(process.execPath, ["-e", "process.stdout.write('partial out');process.stderr.write('partial err');process.exitCode=7"])).toThrow("exit=7");
    expect(f.read().probes[0]).toMatchObject({ state: "failed", exitCode: 7, stdout: "partial out", stderr: "partial err", resolvedExecutable: process.execPath });
    expect(f.read().error?.message).toContain("exit=7");
  });

  it("rejects an empty native version response with its persisted result", () => {
    const f = fixture();
    const executable = f.tool("empty-version", "");
    expect(() => f.recorder().version("empty-version")).toThrow("version command returned no output");
    expect(f.read().probes[0]).toMatchObject({ state: "failed", exitCode: 0, stdout: "" });
    expect(f.read().probes[0]!.resolvedExecutable?.toLowerCase()).toBe(executable.toLowerCase());
    expect(path.basename(f.read().probes[0]!.launcher!).toLowerCase()).toBe(process.platform === "win32" ? "cmd.exe" : "empty-version");
  });

  it("saves partial output and the original native timeout error without retrying", () => {
    const f = fixture();
    let executions = 0;
    let originalError: Error | undefined;
    const recorder = createValidationProbeRecorder({ directory: f.diagnostics, environment: f.environment, log: () => {},
      execute: (file, args, options) => {
        executions += 1;
        expect(options.timeout).toBe(10_000);
        const result = crossSpawn.sync(file, args, { ...options, timeout: 2_000 });
        originalError = result.error;
        return result;
      },
    });
    let failure: unknown;
    try { recorder.command(process.execPath, ["-e", "process.stdout.write('before timeout');process.stderr.write('timeout stderr');setInterval(()=>{},1000)"]); }
    catch (error) { failure = error; }
    expect(executions).toBe(1);
    expect(failure).toBe(originalError);
    expect(originalError).toMatchObject({ code: "ETIMEDOUT" });
    expect(f.read().probes[0]).toMatchObject({ state: "failed", stdout: "before timeout", stderr: "timeout stderr", resolvedExecutable: process.execPath,
      error: { name: "Error", code: "ETIMEDOUT", syscall: `spawnSync ${process.execPath}` } });
    expect(f.read().error?.code).toBe("ETIMEDOUT");
  }, 10_000);

  it("keeps diagnostic output bounded without truncating a successful command's return value", () => {
    const f = fixture();
    const result = f.recorder().command(process.execPath, ["-e", "process.stdout.write('o'.repeat(20000));process.stderr.write('e'.repeat(20000))"]);
    expect(result).toHaveLength(20_000);
    const probe = f.read().probes[0]!;
    expect(probe.stdout).toBe("o".repeat(16_384));
    expect(probe.stderr).toBe("e".repeat(16_384));
    expect(probe).toMatchObject({ state: "completed", stdoutTruncated: true, stderrTruncated: true, maxBuffer: 1_048_576 });
  });

  it("preserves the native maxBuffer failure and bounded evidence", () => {
    const f = fixture();
    expect(() => f.recorder().command(process.execPath, ["-e", "process.stdout.write('x'.repeat(2*1024*1024))"])).toThrow();
    expect(f.read().probes[0]).toMatchObject({ state: "failed", stdoutTruncated: true, error: { code: "ENOBUFS" } });
    expect(f.read().probes[0]!.stdout).toHaveLength(16_384);
  });

  it("records command lookup failures before rethrowing their native errors", () => {
    const f = fixture();
    expect(() => f.recorder().version("daynight-tool-that-does-not-exist")).toThrow();
    expect(f.read().probes[0]).toMatchObject({ state: "failed", resolvedExecutable: null, error: { code: "ENOENT" } });
  });

  it("isolates only the gh child and preserves inherited configuration, credentials, and the parent environment", () => {
    const f = fixture();
    const parent = path.join(f.directory, "parent-config");
    mkdirSync(parent);
    const hostsFile = path.join(parent, "hosts.yml");
    writeFileSync(hostsFile, "fixture-auth-config");
    Object.assign(f.environment, { GH_CONFIG_DIR: parent, XDG_STATE_HOME: parent, XDG_DATA_HOME: parent, GH_TELEMETRY: "enabled", GH_TOKEN: "fixture-secret-not-for-evidence" });
    const originalEnvironment = { ...f.environment };
    const originalParentEnvironment = { ...process.env };
    f.tool("gh", `const fs=require('node:fs');const path=require('node:path');
      if(process.env.GH_TELEMETRY!=='0')throw new Error('telemetry not disabled');
      for(const name of ['GH_CONFIG_DIR','XDG_STATE_HOME','XDG_DATA_HOME']){fs.mkdirSync(process.env[name],{recursive:true});fs.writeFileSync(path.join(process.env[name],'marker'),'isolated');}
      process.stdout.write('gh version fixture\\nrelease URL\\n');`);
    f.tool("other", `if(process.env.GH_CONFIG_DIR!==${JSON.stringify(parent)}||process.env.GH_TELEMETRY!=='enabled')throw new Error('parent configuration changed');process.stdout.write('other version fixture');`);
    const recorder = f.recorder();
    expect(recorder.version("gh")).toBe("gh version fixture");
    expect(recorder.version("other")).toBe("other version fixture");
    for (const directory of ["config", "state", "data"]) expect(readFileSync(path.join(f.diagnostics, "gh", directory, "marker"), "utf8")).toBe("isolated");
    expect(readFileSync(hostsFile, "utf8")).toBe("fixture-auth-config");
    expect(existsSync(path.join(parent, "marker"))).toBe(false);
    expect(f.environment).toEqual(originalEnvironment);
    expect(process.env).toEqual(originalParentEnvironment);
    expect(JSON.stringify(f.read())).not.toContain("fixture-secret-not-for-evidence");
    expect(f.log.join("")).not.toContain("fixture-secret-not-for-evidence");
  });

  it.runIf(process.platform === "win32")("records the PATHEXT-selected shim and its native command interpreter", () => {
    const f = fixture();
    f.tool("ordered-tool", "process.stdout.write('cmd version')", ".cmd");
    const selected = f.tool("ordered-tool", "process.stdout.write('bat version')", ".bat");
    const pathExtensions = ".BAT;.CMD;.EXE;.COM";
    f.environment.PATHEXT = pathExtensions;
    // which@2 reads the parent PATHEXT, as does the pinned cross-spawn launcher.
    vi.stubEnv("PATHEXT", pathExtensions);
    try {
      expect(f.recorder().version("ordered-tool")).toBe("bat version");
      expect(f.read().probes[0]!.resolvedExecutable?.toLowerCase()).toBe(selected.toLowerCase());
      expect(path.basename(f.read().probes[0]!.launcher!).toLowerCase()).toBe("cmd.exe");
    } finally { vi.unstubAllEnvs(); }
  });

  it.each([false, true])("writes full provenance only after every native tool succeeds (gh failure=%s)", (fail) => {
    const f = fixture();
    f.tool("git", "process.stdout.write(process.argv[2]==='rev-parse'?'a'.repeat(40):process.argv[2]==='--version'?'git version fixture':'')");
    f.tool("pnpm", "process.stdout.write('10.34.5')");
    f.tool("gh", fail ? "process.stdout.write('partial gh');process.stderr.write('fixture gh failure');process.exitCode=23" : "process.stdout.write('gh version fixture')");
    const result = crossSpawn.sync(process.execPath, [path.resolve(import.meta.dirname, "../scripts/validation-environment.ts")], {
      cwd: f.directory, env: f.environment, encoding: "utf8", shell: false, windowsHide: true, timeout: 30_000, maxBuffer: 1_048_576,
    });
    if (result.error !== undefined && result.error !== null) throw result.error;
    expect(result.status).toBe(fail ? 1 : 0);
    const evidenceDirectory = path.join(f.directory, ".tmp");
    const diagnostics = JSON.parse(readFileSync(path.join(evidenceDirectory, "validation-probes.json"), "utf8")) as Diagnostics;
    expect(diagnostics.probes).toHaveLength(5);
    expect(diagnostics.probes.at(-1)!.file).toBe("gh");
    expect(existsSync(path.join(evidenceDirectory, "validation-environment.json"))).toBe(!fail);
    if (fail) expect(diagnostics.probes.at(-1)).toMatchObject({ state: "failed", exitCode: 23, stdout: "partial gh", stderr: "fixture gh failure" });
    else {
      const evidence = JSON.parse(readFileSync(path.join(evidenceDirectory, "validation-environment.json"), "utf8"));
      expect(evidence).toMatchObject({ sourceRevision: "a".repeat(40), sourceDirty: false, versions: { node: process.version, pnpm: "10.34.5", git: "git version fixture", gh: "gh version fixture" } });
      expect(evidence.sqlite.engineVersion).not.toBe("");
      expect(diagnostics.probes.every((probe) => probe.state === "completed")).toBe(true);
    }
  }, 40_000);
});
