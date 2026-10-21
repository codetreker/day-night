import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import crossSpawn from "cross-spawn";
import * as pty from "node-pty";
import which from "which";
import type { InstalledCliReceipt } from "./installed-cli.js";
import { terminateInstalledProcess } from "./installed-cli.js";

export type SkillFixture = {
  readonly root: string;
  readonly home: string;
  readonly tools: string;
  readonly agentLog: string;
  readonly environment: NodeJS.ProcessEnv;
};
export type SkillResult = { readonly code: number | null; readonly stdout: string; readonly stderr: string };
export type TerminalAction = { readonly waitFor: string; readonly keys: readonly string[] };
type BridgeResult = {
  readonly code: number | null;
  readonly signal: string | null;
  readonly failure?: string;
  readonly launcherPid: number;
  readonly launcherExit?: { readonly code: number | null; readonly signal: string | null };
  readonly stdinTerminal: boolean;
  readonly stderrTerminal: boolean;
  readonly stdoutTerminal: boolean;
};
export const skillTerminalEvidence: (BridgeResult & { readonly terminalId: number; readonly stdout: string; readonly rawTranscript: string })[] = [];
const activeTerminals = new Set<number>();
export const skillTerminalSessionsClosed = (): boolean => activeTerminals.size === 0;

const delay = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));
const environmentKey = (environment: NodeJS.ProcessEnv, name: string): string => Object.keys(environment).find((key) => key.toLowerCase() === name.toLowerCase()) ?? name;

export const createSkillFixture = async (root: string, agents: readonly string[]): Promise<SkillFixture> => {
  const home = path.join(root, "home 中文");
  const tools = path.join(root, "tools 中文");
  const agentLog = path.join(root, "unexpected-agent-execution");
  const temporary = path.join(root, "temporary");
  await mkdir(home, { recursive: true });
  await mkdir(tools);
  await mkdir(temporary);
  const environment: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => /^(?:SystemRoot|SystemDrive|ComSpec|WINDIR|OS|LANG|LC_ALL|LC_CTYPE)$/i.test(name)));
  environment[environmentKey(environment, "PATH")] = tools;
  environment.HOME = home;
  environment.USERPROFILE = home;
  environment.APPDATA = path.join(home, "AppData/Roaming");
  environment.LOCALAPPDATA = path.join(home, "AppData/Local");
  environment.XDG_CONFIG_HOME = path.join(home, ".config");
  environment.XDG_CACHE_HOME = path.join(home, ".cache");
  environment.TMP = temporary;
  environment.TEMP = temporary;
  environment.TMPDIR = temporary;
  environment.NO_COLOR = "1";
  environment.TERM = "xterm-256color";
  environment.SKILL_AGENT_LOG = agentLog;
  environment.GIT_CONFIG_NOSYSTEM = "1";
  environment.GIT_CONFIG_GLOBAL = path.join(root, "git-global");
  environment.GIT_TERMINAL_PROMPT = "0";
  if (process.platform === "win32") {
    const gitDirectory = path.dirname(await which("git.exe"));
    if ((await readdir(gitDirectory)).some((name) => /^(?:codex|copilot|claude)\.(?:com|exe|bat|cmd)$/i.test(name))) throw new Error("The native Git directory contains an Agent launcher and cannot provide an isolated fixture PATH.");
    environment[environmentKey(environment, "PATH")] = `${tools}${path.delimiter}${gitDirectory}`;
    environment[environmentKey(environment, "PATHEXT")] = ".COM;.EXE;.BAT;.CMD";
    await writeFile(path.join(tools, "node.cmd"), `@"${process.execPath}" %*\r\n`);
    for (const agent of agents) await writeFile(path.join(tools, `${agent}.cmd`), "@echo unexpected>>\"%SKILL_AGENT_LOG%\"\r\n@exit /b 97\r\n");
  } else {
    await symlink(process.execPath, path.join(tools, "node"));
    for (const command of ["git", "dirname", "sed", "uname"]) await symlink(await which(command), path.join(tools, command));
    for (const agent of agents) await writeFile(path.join(tools, agent), "#!/bin/sh\nprintf unexpected >> \"$SKILL_AGENT_LOG\"\nexit 97\n", { mode: 0o755 });
  }
  return { root, home, tools, agentLog, environment };
};

export const skillPipe = async (receipt: InstalledCliReceipt, fixture: SkillFixture, args: readonly string[], cwd = fixture.home): Promise<SkillResult> => {
  const child = crossSpawn(receipt.launcherPath, [...args], {
    cwd, env: fixture.environment, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "", stderr = "";
  child.stdout!.setEncoding("utf8").on("data", (data: string) => { stdout += data; });
  child.stderr!.setEncoding("utf8").on("data", (data: string) => { stderr += data; });
  let failure: Error | undefined;
  child.once("error", (cause) => { failure = cause; });
  const closed = new Promise<number | null>((resolve) => child.once("close", resolve));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const code = await Promise.race([closed, new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), 15_000); })]);
    if (code === "timeout") {
      await terminateInstalledProcess(child, closed);
      throw new Error(`Installed skill command exceeded fifteen seconds.\n${stderr}`);
    }
    if (failure !== undefined) throw failure;
    return { code, stdout, stderr };
  } finally { if (timer !== undefined) clearTimeout(timer); }
};

const stopTerminal = async (terminal: pty.IPty, closed: Promise<unknown>): Promise<void> => {
  const failures: unknown[] = [];
  try { if (process.platform === "win32") {
    const systemRoot = Object.entries(process.env).find(([name]) => name.toLowerCase() === "systemroot")?.[1];
    if (systemRoot === undefined) throw new Error("Cannot terminate owned ConPTY tree without SystemRoot.");
    const killer = spawn(path.join(systemRoot, "System32/taskkill.exe"), ["/PID", String(terminal.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const killed = new Promise<number | null>((resolve, reject) => { killer.once("error", reject); killer.once("close", resolve); });
    let code: number | null;
    try {
      code = await Promise.race([killed, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { killer.kill("SIGKILL"); reject(new Error("Owned ConPTY termination tool exceeded five seconds.")); }, 5_000); })]);
    } finally { if (timer !== undefined) clearTimeout(timer); }
    if (code !== 0 && code !== 128) throw new Error(`Owned ConPTY process-tree termination returned ${String(code)}.`);
  } else {
    try { process.kill(-terminal.pid, "SIGKILL"); }
    catch (cause) { if (!(cause instanceof Error && "code" in cause && cause.code === "ESRCH")) throw cause; }
  } } catch (cause) { failures.push(cause); }
  try { terminal.kill(); } catch (cause) { failures.push(cause); }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([closed, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Owned terminal did not close after termination.")), 5_000); })]);
  } catch (cause) { failures.push(cause); }
  finally { if (timer !== undefined) clearTimeout(timer); }
  if (failures.length !== 0) throw new AggregateError(failures, "Owned terminal process-tree cleanup failed.");
};

let sequence = 0;
export const skillTerminal = async (
  receipt: InstalledCliReceipt,
  fixture: SkillFixture,
  actions: readonly TerminalAction[],
  cwd = fixture.home,
  command: { readonly launcherPath: string; readonly args: readonly string[] } = { launcherPath: receipt.launcherPath, args: ["skill", "install"] },
): Promise<SkillResult> => {
  const id = sequence++;
  const stdoutPath = path.join(fixture.root, `terminal-${id}.stdout`);
  const resultPath = path.join(fixture.root, `terminal-${id}.result.json`);
  const terminal = pty.spawn(process.execPath, [path.join(import.meta.dirname, "skill-terminal-bridge.mjs"), JSON.stringify({ ...command, cwd, stdoutPath, resultPath })], {
    name: "xterm-256color", cols: 100, rows: 32, cwd, env: fixture.environment,
    ...(process.platform === "win32" ? { useConpty: true } : {}),
  });
  let transcript = "";
  let exited = false;
  activeTerminals.add(id);
  const dataListener = terminal.onData((data) => { transcript += data; });
  const closed = new Promise<void>((resolve) => terminal.onExit(() => { exited = true; activeTerminals.delete(id); resolve(); }));
  const deadline = Date.now() + 20_000;
  const until = async (condition: () => boolean, description: string): Promise<void> => {
    while (!condition()) {
      if (Date.now() >= deadline || exited) throw new Error(`Terminal ${description}${exited ? " before child exit" : " exceeded twenty seconds"}.\nRaw transcript:\n${JSON.stringify(transcript)}`);
      await delay(20);
    }
  };
  let primaryFailure: unknown;
  try {
    for (const action of actions) {
      await until(() => stripVTControlCharacters(transcript).includes(action.waitFor), `waiting for ${JSON.stringify(action.waitFor)}`);
      for (const key of action.keys) { terminal.write(key); await delay(75); }
    }
    await until(() => exited, "waiting for completion");
    const bridge = JSON.parse(await readFile(resultPath, "utf8")) as BridgeResult;
    if (bridge.failure !== undefined) throw new Error(`Installed launcher failed: ${bridge.failure}`);
    if (bridge.launcherExit === undefined || (bridge.launcherExit.code === null && bridge.launcherExit.signal === null) || bridge.launcherExit.code !== bridge.code || bridge.launcherExit.signal !== bridge.signal) throw new Error(`Installed launcher did not report matching exit and close events: ${JSON.stringify(bridge)}`);
    if (!bridge.stdinTerminal || !bridge.stderrTerminal || bridge.stdoutTerminal) throw new Error(`Unexpected installed launcher terminal topology: ${JSON.stringify(bridge)}`);
    const stdout = await readFile(stdoutPath, "utf8");
    skillTerminalEvidence.push({ ...bridge, terminalId: id, stdout, rawTranscript: transcript });
    return { code: bridge.code, stdout, stderr: transcript };
  } catch (cause) { primaryFailure = cause; throw cause; }
  finally {
    const failures: unknown[] = [];
    if (!exited) { try { await stopTerminal(terminal, closed); } catch (cause) { failures.push(cause); } }
    dataListener.dispose();
    try { await writeFile(path.join(fixture.root, `terminal-${id}.raw`), transcript); } catch (cause) { failures.push(cause); }
    if (failures.length !== 0) throw new AggregateError(primaryFailure === undefined ? failures : [primaryFailure, ...failures], "Native skill terminal cleanup failed.");
  }
};
