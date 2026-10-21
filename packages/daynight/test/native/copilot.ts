import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import which from "which";
import type { NativeHostEvent, NativeHostRequest, NativeHostResult } from "./host.js";
import {
  assertNativeStateHasNoSecrets,
  nativeNumericUsage,
  nativeRecord,
  nativeRedactor,
  nativeSecrets,
  nativeSkillContents,
  nativeString,
  runNativeProcess,
} from "./copilot-process.js";

const originalGhDirectory = (): string => process.env.GH_CONFIG_DIR
  ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "gh");

const originalCopilotCredential = async (): Promise<string> => {
  for (const name of ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"]) {
    const value = process.env[name];
    if (value === undefined) continue;
    if (value.trim() === "") throw new Error(`The configured ${name} credential is empty; configure the original Copilot authentication before rerunning native acceptance`);
    return value.trim();
  }
  let executable: string;
  try { executable = await which("gh", { path: process.env.PATH }); }
  catch { throw new Error("The original GitHub CLI is unavailable; authenticate its existing profile before rerunning Copilot native acceptance"); }
  const host = process.env.COPILOT_GH_HOST ?? process.env.GH_HOST ?? "github.com";
  let credential: string;
  try {
    credential = execFileSync(executable, ["auth", "token", "--hostname", host], {
      env: { ...process.env, GH_CONFIG_DIR: originalGhDirectory() },
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 64 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }).trim();
  } catch {
    throw new Error(`The original GitHub CLI could not provide an existing credential for ${host}; check its authentication before rerunning Copilot native acceptance. Private authentication output was discarded`);
  }
  if (credential === "") throw new Error(`The original GitHub CLI returned an empty credential for ${host}; configure its existing authentication before rerunning Copilot native acceptance`);
  return credential;
};

const nativeSessionSkills = async (directory: string, sessionId: string, request: NativeHostRequest, redact: (text: string) => string): Promise<readonly NativeHostEvent[]> => {
  const skills: NativeHostEvent[] = [];
  const entrypoints = new Set(request.skillEntrypoints.map((path) => resolve(path)));
  const expected = nativeSkillContents(request.expectedSkillContents);
  const verifiedContentIds = new Set<string>();
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) throw new Error("Copilot returned an invalid native session identifier");
  const path = join(directory, "session-state", sessionId, "events.jsonl");
  for (const line of (await readFile(path, "utf8")).split("\n")) {
    if (line.trim() === "") continue;
    const event = nativeRecord(JSON.parse(line));
    if (event === undefined || typeof event.type !== "string") throw new Error("Invalid Copilot native session event");
    if (!["skill.invoked", "skill.invoked_ref", "skill.context_delivered", "skill.context_delivered_ref"].includes(event.type)) continue;
    const data = nativeRecord(event.data);
    if (data === undefined) throw new Error("Copilot skill event lacks data");
    const content = nativeString(data.content);
    const ownedInvocation = data.name === "daynight" && typeof data.path === "string" && entrypoints.has(resolve(request.workingDirectory, data.path));
    const delivered = data.source === "skill-daynight";
    const bodyMatches = content !== undefined && content.replaceAll("\r\n", "\n").includes(expected.body);
    const invocationMatches = content !== undefined && [expected.full.trim(), expected.body].includes(content.replaceAll("\r\n", "\n").trim());
    if ((ownedInvocation && invocationMatches) || (delivered && bodyMatches)) {
      verifiedContentIds.add(`sha256:${createHash("sha256").update(content).digest("hex")}`);
    }
    if (!delivered || !event.type.startsWith("skill.context_delivered")) continue;
    if (!bodyMatches && !(typeof data.contentId === "string" && verifiedContentIds.has(data.contentId))) continue;
    const metadata = Object.fromEntries(["name", "path", "source", "trigger", "model", "contentId"].flatMap((name) =>
      typeof data[name] === "string" ? [[name, redact(data[name])]] : [],
    ));
    if (content !== undefined) metadata.contentSha256 = createHash("sha256").update(content).digest("hex");
    skills.push({ kind: "skill", text: `${event.type} ${JSON.stringify(metadata)}` });
  }
  return skills;
};

export const runCopilot = async (request: NativeHostRequest): Promise<NativeHostResult> => {
  const credential = await originalCopilotCredential();
  // Copilot suppresses personal .agents discovery when COPILOT_HOME differs from HOME/.copilot.
  const config = join(request.homeDirectory, ".copilot");
  const logs = join(request.stateDirectory, "logs");
  const temporary = join(request.stateDirectory, "tmp");
  const authentication = Object.fromEntries([
    "COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN", "COPILOT_MODEL", "GH_HOST", "COPILOT_GH_HOST",
  ].flatMap((name) => process.env[name] === undefined ? [] : [[name, process.env[name]]]));
  const environment: NodeJS.ProcessEnv = {
    ...authentication,
    ...request.environment,
    COPILOT_GITHUB_TOKEN: credential,
    HOME: request.homeDirectory,
    USERPROFILE: request.homeDirectory,
    COPILOT_HOME: config,
    GH_CONFIG_DIR: request.environment.GH_CONFIG_DIR ?? originalGhDirectory(),
    TMPDIR: temporary,
    TMP: temporary,
    TEMP: temporary,
    COPILOT_AUTO_UPDATE: "false",
    COPILOT_OTEL_ENABLED: "false",
    USE_TGREP: "false",
  };
  const secrets = nativeSecrets(environment);
  const redact = nativeRedactor(secrets);
  const events: NativeHostEvent[] = [];
  let finalText = "";
  let sessionId: string | undefined;
  let model = environment.COPILOT_MODEL;
  let usage: Readonly<Record<string, number>> = {};
  const onJson = (event: Record<string, unknown>): void => {
    const data = nativeRecord(event.data);
    if (event.type === "assistant.message" && typeof data?.content === "string") {
      model = nativeString(data.model) ?? model;
      finalText = redact(data.content);
      events.push({ kind: "message", text: finalText });
    }
    if (event.type === "tool.execution_start") {
      const arguments_ = nativeRecord(data?.arguments);
      if (typeof arguments_?.command === "string") events.push({ kind: "command", text: redact(arguments_.command) });
    }
    if (event.type === "session.model_change") model = nativeString(data?.newModel) ?? model;
    if (event.type === "assistant.usage") model = nativeString(data?.model) ?? model;
    if (event.type === "result") {
      sessionId = nativeString(event.sessionId);
      usage = nativeNumericUsage(event.usage);
      finalText = redact(nativeString(event.result) ?? nativeString(event.response) ?? finalText);
      if (event.exitCode !== 0) throw new Error(`Copilot native result reported exit code ${String(event.exitCode)}`);
    }
  };
  const arguments_ = [
    "--no-auto-update", "--disable-client-telemetry", "--no-ask-user", "--disable-builtin-mcps",
    "--trust-folder", "--output-format", "json", "--no-color", "--log-level", "none", "--log-dir", logs,
    "--allow-tool=write", "--allow-tool=shell(daynight:*)", "--allow-tool=shell(gh pr view:*)",
    "--allow-tool=shell(git status:*)", "--allow-tool=shell(git diff:*)", "--allow-tool=shell(node:*)",
    "--allow-tool=shell(cat:*)", "--allow-tool=shell(pwd)", "--allow-tool=shell(ls:*)", "--allow-tool=shell(rg:*)",
    "--deny-tool=shell(gh pr merge:*)", "--deny-tool=shell(git push:*)",
    "--secret-env-vars=COPILOT_GITHUB_TOKEN,GH_TOKEN,GITHUB_TOKEN",
    "--allow-url=https://github.com", "--allow-url=https://api.github.com",
  ];
  let result: NativeHostResult | undefined;
  const failures: unknown[] = [];
  try {
    await Promise.all([mkdir(config, { recursive: true }), mkdir(logs, { recursive: true }), mkdir(temporary, { recursive: true })]);
    const version = await runNativeProcess({ executable: "copilot", arguments: ["--no-auto-update", "--version"], cwd: request.workingDirectory, environment, timeoutMs: 15_000, redact });
    await runNativeProcess({ executable: "copilot", arguments: arguments_, cwd: request.workingDirectory, environment, input: request.prompt, timeoutMs: request.timeoutMs, redact, onJson });
    if (sessionId === undefined) throw new Error("Copilot native turn completed without a session identifier");
    events.push(...await nativeSessionSkills(config, sessionId, request, redact));
    if (finalText === "") throw new Error("Copilot native turn completed without an assistant message");
    result = { host: "copilot", version, ...(model === undefined ? {} : { model: redact(model) }), events, usage, finalText };
  } catch (cause) { failures.push(cause); }
  for (const directory of [request.stateDirectory, request.homeDirectory]) {
    try { await assertNativeStateHasNoSecrets(directory, secrets); } catch (cause) { failures.push(cause); }
  }
  for (const directory of [config, logs, temporary]) {
    try { await rm(directory, { recursive: true, force: true }); } catch (cause) { failures.push(cause); }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "Copilot native execution, credential verification, or cleanup failed");
  if (result === undefined) throw new Error("Copilot native execution produced no result");
  return result;
};
