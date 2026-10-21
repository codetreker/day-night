import { mkdir, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
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

const originalProvider = async (): Promise<{ environment: NodeJS.ProcessEnv; model?: string }> => {
  const path = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "settings.json");
  let settings: Record<string, unknown> = {};
  try {
    const parsed = nativeRecord(JSON.parse(await readFile(path, "utf8")));
    if (parsed === undefined) throw new Error("Claude settings must contain an object");
    settings = parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const environment: NodeJS.ProcessEnv = {};
  for (const source of [nativeRecord(settings.env) ?? {}, process.env]) {
    for (const [name, value] of Object.entries(source)) {
      if (/^ANTHROPIC_/.test(name) && typeof value === "string") environment[name] = value;
    }
  }
  const model = nativeString(settings.model);
  return { environment, ...(model === undefined ? {} : { model }) };
};

export const runClaude = async (request: NativeHostRequest): Promise<NativeHostResult> => {
  const provider = await originalProvider();
  const config = join(request.stateDirectory, "claude");
  const temporary = join(request.stateDirectory, "tmp");
  const environment: NodeJS.ProcessEnv = {
    ...provider.environment,
    ...request.environment,
    HOME: request.homeDirectory,
    USERPROFILE: request.homeDirectory,
    GH_CONFIG_DIR: request.environment.GH_CONFIG_DIR ?? process.env.GH_CONFIG_DIR
      ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "gh"),
    CLAUDE_CONFIG_DIR: config,
    TMPDIR: temporary,
    TMP: temporary,
    TEMP: temporary,
    CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: "1",
    CLAUDE_CODE_SKIP_AUTH_LOGIN: "1",
    DISABLE_AUTOUPDATER: "1",
    DISABLE_UPDATES: "1",
    DISABLE_TELEMETRY: "1",
    DISABLE_ERROR_REPORTING: "1",
  };
  const secrets = nativeSecrets(environment);
  const redact = nativeRedactor(secrets);
  const events: NativeHostEvent[] = [];
  const entrypoints = new Set(request.skillEntrypoints.map((path) => resolve(path)));
  const skillDirectories = new Set([...entrypoints].map(dirname));
  const contents = nativeSkillContents(request.expectedSkillContents);
  const pendingReads = new Map<string, string>();
  const pendingSkills = new Map<string, { successful: boolean; delivered: boolean; recorded: boolean }>();
  let latestSkill: string | undefined;
  let finalText = "";
  let model = provider.model;
  let usage: Readonly<Record<string, number>> = {};
  const onJson = (event: Record<string, unknown>): void => {
    if (event.type === "system" && event.subtype === "init") model = nativeString(event.model) ?? model;
    if (event.type === "assistant") {
      const message = nativeRecord(event.message);
      if (message === undefined) return;
      model = nativeString(message.model) ?? model;
      if (!Array.isArray(message.content)) return;
      for (const value of message.content) {
        const item = nativeRecord(value);
        if (item?.type === "text" && typeof item.text === "string") {
          events.push({ kind: "message", text: redact(item.text) });
        }
        if (item?.type !== "tool_use") continue;
        const input = nativeRecord(item.input);
        if (item.name === "Skill" && input?.skill === "daynight" && typeof item.id === "string") {
          latestSkill = item.id;
          pendingSkills.set(item.id, { successful: false, delivered: false, recorded: false });
        }
        if (item.name === "Read" && typeof input?.file_path === "string" && typeof item.id === "string") {
          const path = resolve(request.workingDirectory, input.file_path);
          if (entrypoints.has(path)) pendingReads.set(item.id, path);
        }
        if (item.name === "Bash" && typeof input?.command === "string") {
          events.push({ kind: "command", text: redact(input.command) });
        }
      }
    }
    if (event.type === "user") {
      const content = nativeRecord(event.message)?.content;
      const blocks = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
      for (const value of blocks) {
        const item = nativeRecord(value);
        if (item?.type === "tool_result" && typeof item.tool_use_id === "string") {
          const read = pendingReads.get(item.tool_use_id);
          pendingReads.delete(item.tool_use_id);
          const skill = pendingSkills.get(item.tool_use_id);
          if (item.is_error === true) {
            pendingSkills.delete(item.tool_use_id);
            continue;
          }
          if (skill !== undefined) skill.successful = true;
          const texts = typeof item.content === "string" ? [item.content] : Array.isArray(item.content)
            ? item.content.flatMap((part) => { const text = nativeRecord(part)?.text; return typeof text === "string" ? [text] : []; }) : [];
          if (read !== undefined && texts.some((text) => {
            if (text.replaceAll("\r\n", "\n").replace(/\n$/, "") === contents.full) return true;
            const numbered = text.replaceAll("\r\n", "\n").split("\n").flatMap((line) => {
              const match = /^\s*(\d+)(?:→|\t|:)(.*)$/.exec(line);
              return match === null ? [] : [{ number: Number(match[1]), text: match[2] as string }];
            });
            return numbered.length > 0 && numbered.every((line, index) => line.number === index + 1)
              && numbered.map((line) => line.text).join("\n").replace(/\n$/, "") === contents.full;
          })) events.push({ kind: "skill", text: `Successfully read exact installed skill contents: ${redact(read)}` });
        }
        if (event.isSynthetic === true && item?.type === "text" && typeof item.text === "string" && latestSkill !== undefined) {
          const base = /^Base directory for this skill: ([^\n]+)\n/.exec(item.text);
          const skill = pendingSkills.get(latestSkill);
          if (base !== null && skillDirectories.has(resolve(base[1] as string)) && skill !== undefined
            && item.text.replaceAll("\r\n", "\n").includes(contents.body)) skill.delivered = true;
        }
      }
      for (const skill of pendingSkills.values()) {
        if (skill.successful && skill.delivered && !skill.recorded) {
          skill.recorded = true;
          events.push({ kind: "skill", text: "Native Skill daynight succeeded and delivered the exact installed instruction body" });
        }
      }
    }
    if (event.type === "result") {
      finalText = redact(nativeString(event.result) ?? "");
      usage = nativeNumericUsage(event.usage);
      if (event.is_error === true) {
        const errors = Array.isArray(event.errors) ? event.errors.filter((value): value is string => typeof value === "string").join("; ") : finalText;
        throw new Error(`Claude native turn failed: ${redact(errors)}`);
      }
    }
  };
  const arguments_ = [
    "--print", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
    "--no-session-persistence", "--no-chrome", "--permission-mode", "dontAsk",
    "--tools", "Read,Bash,Skill,Edit,Write,Glob,Grep",
    "--allowedTools", "Read", "Skill", "Edit", "Write", "Glob", "Grep",
    "Bash(daynight *)", "Bash(gh pr view *)", "Bash(git status *)", "Bash(git diff *)",
    "Bash(node *)", "Bash(cat *)", "Bash(pwd)", "Bash(ls *)", "Bash(rg *)",
    "--strict-mcp-config", "--mcp-config", JSON.stringify({ mcpServers: {} }),
    ...(provider.model === undefined ? [] : ["--model", provider.model]),
  ];
  let result: NativeHostResult | undefined;
  const failures: unknown[] = [];
  try {
    await Promise.all([mkdir(config, { recursive: true }), mkdir(temporary, { recursive: true })]);
    const version = await runNativeProcess({ executable: "claude", arguments: ["--version"], cwd: request.workingDirectory, environment, timeoutMs: 15_000, redact });
    await runNativeProcess({ executable: "claude", arguments: arguments_, cwd: request.workingDirectory, environment, input: request.prompt, timeoutMs: request.timeoutMs, redact, onJson });
    if (finalText === "") throw new Error("Claude native turn completed without a result");
    result = { host: "claude", version, ...(model === undefined ? {} : { model: redact(model) }), events, usage, finalText };
  } catch (cause) { failures.push(cause); }
  for (const directory of [request.stateDirectory, request.homeDirectory]) {
    try { await assertNativeStateHasNoSecrets(directory, secrets); } catch (cause) { failures.push(cause); }
  }
  for (const directory of [config, temporary]) {
    try { await rm(directory, { recursive: true, force: true }); } catch (cause) { failures.push(cause); }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "Claude native execution, credential verification, or cleanup failed");
  if (result === undefined) throw new Error("Claude native execution produced no result");
  return result;
};
