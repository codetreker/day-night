import { spawn } from "node:child_process";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { terminateInstalledProcess } from "../fixtures/installed-cli.js";

export const nativeRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

export const nativeString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

export const nativeSecrets = (environment: NodeJS.ProcessEnv): readonly string[] =>
  Object.entries(environment)
    .filter(([name, value]) => /token|secret|password|api.?key|authorization/i.test(name) && value !== undefined && value.length >= 8)
    .map(([, value]) => value as string);

export const nativeRedactor = (secrets: readonly string[]): ((value: string) => string) => {
  const values = [...new Set(secrets.filter((value) => value.length >= 8))].sort((left, right) => right.length - left.length);
  return (value) => values.reduce((result, secret) => result.replaceAll(secret, "[REDACTED]"), value);
};

export const nativeNumericUsage = (value: unknown): Readonly<Record<string, number>> => {
  const record = nativeRecord(value);
  return record === undefined ? {} : Object.fromEntries(
    Object.entries(record).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])),
  );
};

export const nativeSkillContents = (source: string): { readonly full: string; readonly body: string } => {
  const full = source.replaceAll("\r\n", "\n").replace(/\n$/, "");
  const closing = full.startsWith("---\n") ? full.indexOf("\n---\n", 4) : -1;
  // Native loaders inject Markdown instructions separately from YAML metadata.
  // https://github.com/github/copilot-sdk/blob/bb8a5c3a32478cc69b36d905688b7abbdaeda7c0/docs/features/skills.md#L311-L337
  return { full, body: (closing === -1 ? full : full.slice(closing + 5)).trim() };
};

export const assertNativeStateHasNoSecrets = async (
  directory: string,
  secrets: readonly string[],
): Promise<void> => {
  const needles = secrets.filter((secret) => secret.length >= 8).map((secret) => Buffer.from(secret));
  if (needles.length === 0) return;
  const visit = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      const info = await lstat(path);
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) await visit(path);
      else if (info.isFile()) {
        const contents = await readFile(path);
        if (needles.some((needle) => contents.includes(needle))) {
          throw new Error(`Native host persisted a credential in ${relative(directory, path)}`);
        }
      }
    }
  };
  await visit(directory);
};

type NativeProcessRequest = {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly cwd: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly input?: string;
  readonly timeoutMs: number;
  readonly redact: (value: string) => string;
  readonly onJson?: (event: Record<string, unknown>) => void;
};

export const runNativeProcess = async (request: NativeProcessRequest): Promise<string> => {
  const child = spawn(request.executable, [...request.arguments], {
    cwd: request.cwd,
    env: request.environment,
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  let pending = "";
  let outputBytes = 0;
  let protocolFailure: Error | undefined;
  let rejectProtocol: (cause: Error) => void = () => {};
  const failed = new Promise<never>((_resolve, reject) => { rejectProtocol = reject; });
  const fail = (cause: unknown): void => {
    protocolFailure = new Error(request.redact(cause instanceof Error ? cause.message : String(cause)));
    rejectProtocol(protocolFailure);
  };
  const consume = (line: string): void => {
    if (request.onJson === undefined || line.trim() === "" || protocolFailure !== undefined) return;
    try {
      const event = nativeRecord(JSON.parse(line));
      if (event === undefined) throw new Error("Native host emitted a JSON value without an event object");
      request.onJson(event);
    } catch (error) {
      fail(error);
    }
  };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    outputBytes += Buffer.byteLength(chunk);
    if (outputBytes > 16 * 1024 * 1024) {
      fail(new Error("Native host exceeded the 16 MiB output limit"));
      return;
    }
    if (request.onJson === undefined) stdout += chunk;
    else {
      pending += chunk;
      let newline: number;
      while ((newline = pending.indexOf("\n")) !== -1) {
        consume(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
      }
    }
  });
  child.stderr.on("data", (chunk: string) => { stderr = request.redact(stderr + chunk).slice(-8_000); });
  let timeout: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(`Native host exceeded ${request.timeoutMs} ms${stderr === "" ? "" : `: ${stderr}`}`)), request.timeoutMs);
  });
  child.stdin.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EPIPE") fail(error);
  });
  child.stdout.on("error", fail);
  child.stderr.on("error", fail);
  child.once("error", fail);
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  child.stdin.end(request.input);
  let result: string | undefined;
  const failures: unknown[] = [];
  try {
    const { code, signal } = await Promise.race([closed, failed, deadline]);
    if (pending !== "") consume(pending);
    if (protocolFailure !== undefined) throw protocolFailure;
    if (code !== 0) throw new Error(`Native host exited with ${code ?? signal}${stderr === "" ? "" : `: ${stderr}`}`);
    result = request.redact(stdout).trim();
  } catch (cause) { failures.push(cause); }
  if (timeout !== undefined) clearTimeout(timeout);
  try { await terminateInstalledProcess(child, closed); }
  catch (cause) { failures.push(cause); }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "Native host execution and process cleanup failed");
  if (result === undefined) throw new Error("Native host execution produced no result");
  return result;
};
