import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import which from "which";
import { terminateInstalledProcess } from "../fixtures/installed-cli.js";
import type { NativeHostEvent, NativeHostRequest, NativeHostResult } from "./host.js";
import { assertCodexNoCredentialFiles, codexPrivateEnvironmentValues, isCodexPrivateEnvironmentName, redactCodexPrivateValues } from "./codex-privacy.js";
import { exactCodexConfigCat, readOwnedCodexConfig } from "./codex-config-read.js";

type JsonObject = Record<string, unknown>;
type PendingRequest = { readonly resolve: (value: JsonObject) => void; readonly reject: (cause: Error) => void };

const object = (value: unknown, label: string): JsonObject => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`Codex ${label} is not an object.`);
  return value as JsonObject;
};
const string = (value: unknown, label: string): string => {
  if (typeof value !== "string") throw new Error(`Codex ${label} is not a string.`);
  return value;
};
const tomlValue = (value: unknown): string => {
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(tomlValue).join(", ")}]`;
  throw new Error("The selected Codex provider contains an unsupported TOML value.");
};
const toml = (value: JsonObject, keys: readonly string[] = []): string => {
  const scalars = Object.entries(value).filter(([, item]) => item === null || typeof item !== "object" || Array.isArray(item));
  const tables = Object.entries(value).filter(([, item]) => item !== null && typeof item === "object" && !Array.isArray(item));
  return `${keys.length === 0 ? "" : `[${keys.map((key) => JSON.stringify(key)).join(".")}]\n`}${scalars.map(([key, item]) => `${JSON.stringify(key)} = ${tomlValue(item)}\n`).join("")}${tables.map(([key, item]) => `\n${toml(object(item, "configuration table"), [...keys, key])}`).join("")}`;
};

export const runCodex = async (request: NativeHostRequest): Promise<NativeHostResult> => {
  const sandbox = process.env.DAYNIGHT_NATIVE_CODEX_SANDBOX ?? "workspace-write";
  if (sandbox !== "workspace-write" && sandbox !== "danger-full-access") throw new Error("DAYNIGHT_NATIVE_CODEX_SANDBOX must be workspace-write or danger-full-access.");
  if (sandbox === "workspace-write") {
    try { execFileSync(await which("unshare", { path: process.env.PATH }), ["--user", "--map-root-user", "--", "true"], { timeout: 5_000, stdio: ["ignore", "pipe", "pipe"] }); }
    catch { throw new Error("Codex workspace-write requires usable user namespaces. For this trusted native acceptance fixture, explicitly select DAYNIGHT_NATIVE_CODEX_SANDBOX=danger-full-access to run without OS sandbox confinement."); }
  }
  const installedSkills = new Set(request.skillEntrypoints.map((entrypoint) => path.resolve(entrypoint)));
  if (installedSkills.size === 0 || request.expectedSkillContents === "") throw new Error("The Codex fixture has no expected installed skill.");
  for (const entrypoint of installedSkills) if (await readFile(entrypoint, "utf8") !== request.expectedSkillContents) throw new Error("The Codex fixture skill differs from the expected installed bundle.");
  const binary = await which("codex", { path: process.env.PATH });
  const executable = await open(binary, "r");
  let nodeLauncher: boolean;
  try {
    const prefix = Buffer.alloc(256);
    const { bytesRead } = await executable.read(prefix, 0, prefix.length, 0);
    nodeLauncher = /^#!\s*(?:\/usr\/bin\/env\s+node|[^\s]+\/node)(?:\s|$)/.test(prefix.subarray(0, bytesRead).toString("utf8").split("\n")[0]!);
  } finally { await executable.close(); }
  const python = await which("python3", { path: process.env.PATH });
  const version = execFileSync(binary, ["--version"], { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
  const originalHome = process.env.HOME ?? os.homedir();
  const originalCodexHome = process.env.CODEX_HOME;
  const originalConfiguration = path.join(originalCodexHome ?? path.join(originalHome, ".codex"), "config.toml");
  const parsed: unknown = JSON.parse(execFileSync(python, ["-c", "import json,sys,tomllib; print(json.dumps(tomllib.load(open(sys.argv[1], 'rb'))))", originalConfiguration], { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] }));
  const configured = object(parsed, "operator configuration");
  const providerName = string(configured.model_provider, "configured provider");
  const provider = { ...object(object(configured.model_providers, "configured providers")[providerName], "selected provider") };
  const auth = object(provider.auth, "command-backed provider authentication");
  const authCommand = string(auth.command, "authentication command");
  if (!Array.isArray(auth.args) || auth.args.some((arg) => typeof arg !== "string")) throw new Error("Codex authentication arguments are not a string array.");
  const authArguments = auth.args as string[];
  if (authCommand !== "sh" || authArguments.length !== 2 || authArguments[0] !== "-c" || !/^cat "\$\{CODEX_HOME:-\$HOME\/\.codex\}\/[A-Za-z0-9._-]+"$/.test(authArguments[1]!)) throw new Error("The configured Codex authentication helper no longer matches the verified read-only token-file command.");
  const home = path.join(request.stateDirectory, "codex");
  const environment: NodeJS.ProcessEnv = { ...request.environment, HOME: request.homeDirectory, CODEX_HOME: home };
  const credentials = codexPrivateEnvironmentValues(process.env);
  let credential: string;
  try { credential = execFileSync(authCommand, authArguments, { encoding: "utf8", timeout: 10_000, maxBuffer: 64 * 1024, stdio: ["ignore", "pipe", "pipe"], env: process.env }).trim(); }
  catch { throw new Error("The configured Codex read-only authentication helper failed; its private output was discarded."); }
  if (credential === "") throw new Error("The configured Codex authentication helper returned an empty credential.");
  credentials.push({ label: "command-auth helper token", value: credential });
  const headers: Record<string, string> = {};
  let headerIndex = 0;
  const addHeader = (name: string, value: string): void => {
    const variable = `DAYNIGHT_NATIVE_CODEX_HEADER_${headerIndex++}`;
    environment[variable] = value;
    credentials.push({ label: `provider header ${name}`, value });
    headers[name] = variable;
  };
  if (provider.http_headers !== undefined) for (const [name, value] of Object.entries(object(provider.http_headers, "static provider headers"))) addHeader(name, string(value, "static provider header"));
  if (provider.env_http_headers !== undefined) for (const [name, variable] of Object.entries(object(provider.env_http_headers, "environment provider headers"))) {
    const value = process.env[string(variable, "provider header environment name")];
    if (value === undefined) throw new Error("A configured Codex provider header environment variable is unavailable.");
    addHeader(name, value);
  }
  delete provider.http_headers;
  provider.env_http_headers = headers;
  environment.DAYNIGHT_NATIVE_CODEX_AUTH = JSON.stringify({ command: authCommand, args: auth.args, home: originalHome, codexHome: originalCodexHome ?? null });
  credentials.push({ label: "command-auth bridge routing", value: environment.DAYNIGHT_NATIVE_CODEX_AUTH });
  provider.auth = { command: python, args: [path.join(import.meta.dirname, "codex-auth.py")] };
  const shellEnvironment = Object.fromEntries(Object.entries(request.environment).filter(([name, value]) => value !== undefined && !isCodexPrivateEnvironmentName(name)));
  shellEnvironment.HOME = request.homeDirectory;
  shellEnvironment.CODEX_HOME = home;
  const configuration: JsonObject = {
    model: string(configured.model, "configured model"), model_provider: providerName,
    ...(configured.model_reasoning_effort === undefined ? {} : { model_reasoning_effort: configured.model_reasoning_effort }),
    cli_auth_credentials_store: "ephemeral", model_providers: { [providerName]: provider },
    features: { shell_snapshot: false },
    shell_environment_policy: { inherit: "none", exclude: ["*TOKEN*", "*SECRET*", "*PASSWORD*", "*API_KEY*", "*AUTH*", "*CREDENTIAL*", "DAYNIGHT_NATIVE_CODEX_*"], set: shellEnvironment },
    sandbox_workspace_write: { network_access: true, writable_roots: [request.fixtureDirectory, request.workingDirectory, request.homeDirectory, request.stateDirectory] },
    analytics: { enabled: false }, feedback: { enabled: false },
  };
  await mkdir(home, { recursive: true, mode: 0o700 });
  const redact = (value: string): string => redactCodexPrivateValues(value, credentials);
  let result: NativeHostResult | undefined;
  let failure: unknown;
  try {
    await writeFile(path.join(home, "config.toml"), toml(configuration), { mode: 0o600 });
    // The fixture's node wrapper closes stdin for recorded commands; pin Node for the host's persistent RPC transport.
    const child = spawn(nodeLauncher ? process.execPath : binary, [...(nodeLauncher ? [binary] : []), "app-server", "--stdio"], { cwd: request.workingDirectory, env: environment, detached: process.platform !== "win32", windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
    const pending = new Map<number, PendingRequest>();
    const events: NativeHostEvent[] = [];
    let sequence = 0;
    let stderr = "";
    let buffer = "";
    let finalText = "";
    let usage: Readonly<Record<string, number>> | undefined;
    let resolveTurn: () => void = () => {};
    let rejectTurn: (cause: Error) => void = () => {};
    let terminalFailure: Error | undefined;
    let turnFinished = false;
    const completed = new Promise<void>((resolve, reject) => { resolveTurn = resolve; rejectTurn = reject; });
    // Initialization failures can precede the point at which the turn promise is awaited.
    void completed.catch(() => {});
    const fail = (cause: unknown): void => {
      const error = cause instanceof Error ? new Error(redact(cause.message)) : new Error("Codex native protocol failed.");
      terminalFailure = error;
      for (const operation of pending.values()) operation.reject(error);
      pending.clear();
      rejectTurn(error);
    };
    const send = (value: unknown): void => { child.stdin.write(`${JSON.stringify(value)}\n`); };
    const rpc = async (method: string, params: unknown): Promise<JsonObject> => {
      if (terminalFailure !== undefined) throw terminalFailure;
      const id = ++sequence;
      const promise = new Promise<JsonObject>((resolve, reject) => pending.set(id, { resolve, reject }));
      send({ id, method, params });
      return promise;
    };
    const observeItem = (value: unknown): void => {
      const item = object(value, "completed item");
      if (item.type === "commandExecution") {
        const command = redact(string(item.command, "executed command"));
        const actions = Array.isArray(item.commandActions) ? item.commandActions : [];
        let observedFile: NativeHostEvent["observedFile"];
        if (item.status === "completed" && item.exitCode === 0 && typeof item.aggregatedOutput === "string") {
          const filenames: string[] = [];
          for (const action of actions) {
            const candidate = object(action, "command action");
            if (candidate.type !== "read" || typeof candidate.path !== "string") continue;
            filenames.push(path.resolve(string(item.cwd, "command working directory"), candidate.path));
          }
          if (path.resolve(string(item.cwd, "command working directory")) === path.resolve(request.workingDirectory)) {
            const configCat = exactCodexConfigCat(string(item.command, "executed command"), request.workingDirectory);
            if (configCat !== undefined) filenames.push(configCat);
          }
          for (const filename of new Set(filenames)) {
            const relative = path.relative(request.fixtureDirectory, filename);
            const contents = readOwnedCodexConfig(filename, request.fixtureDirectory);
            if (contents === undefined || contents === "") continue;
            const start = item.aggregatedOutput.indexOf(contents);
            if (start === -1) continue;
            const matchedContents = item.aggregatedOutput.slice(start, start + contents.length);
            observedFile = { path: redact(relative.replaceAll(path.sep, "/")), sha256: createHash("sha256").update(matchedContents).digest("hex") };
            break;
          }
        }
        events.push({ kind: "command", text: command,
          ...(typeof item.exitCode === "number" ? { exitCode: item.exitCode } : {}),
          ...(observedFile === undefined ? {} : { observedFile }),
        });
        const skillRead = actions.some((action) => {
          const candidate = object(action, "command action");
          return candidate.type === "read" && typeof candidate.path === "string" && installedSkills.has(path.resolve(string(item.cwd, "command working directory"), candidate.path));
        });
        if (item.status === "completed" && item.exitCode === 0 && skillRead && typeof item.aggregatedOutput === "string") {
          const start = item.aggregatedOutput.indexOf(request.expectedSkillContents);
          if (start !== -1) {
            const matchedContents = item.aggregatedOutput.slice(start, start + request.expectedSkillContents.length);
            const digest = createHash("sha256").update(matchedContents).digest("hex");
            events.push({ kind: "skill", text: `Read the installed daynight/SKILL.md with exact bundled content (sha256:${digest}).` });
          }
        }
      } else if (item.type === "agentMessage") {
        const text = redact(string(item.text, "agent message"));
        events.push({ kind: "message", text });
        if (item.phase === "final_answer" || item.phase === null) finalText = text;
      }
    };
    const receive = (message: JsonObject): void => {
      if (typeof message.id === "number" && message.method === undefined) {
        const operation = pending.get(message.id);
        if (operation === undefined) return;
        pending.delete(message.id);
        if (message.error !== undefined) operation.reject(new Error(`Codex request failed: ${redact(JSON.stringify(message.error))}`));
        else operation.resolve(object(message.result, "RPC result"));
        return;
      }
      if (message.id !== undefined) {
        send({ id: message.id, error: { code: -32601, message: "Interactive client requests are unavailable in native acceptance." } });
        return;
      }
      if (message.method === "item/completed") observeItem(object(message.params, "item notification").item);
      else if (message.method === "thread/tokenUsage/updated") {
        const total = object(object(object(message.params, "usage notification").tokenUsage, "token usage").total, "total token usage");
        usage = Object.fromEntries(Object.entries(total).filter((entry): entry is [string, number] => typeof entry[1] === "number"));
      } else if (message.method === "turn/completed") {
        const turn = object(object(message.params, "turn notification").turn, "completed turn");
        if (turn.status !== "completed") fail(new Error(`Codex turn ended with status ${String(turn.status)}: ${redact(JSON.stringify(turn.error))}`));
        else { turnFinished = true; resolveTurn(); }
      }
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      try {
        buffer += chunk;
        if (buffer.length > 16 * 1024 * 1024) throw new Error("Codex native protocol exceeded the bounded line buffer.");
        let newline: number;
        while ((newline = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (line.trim() !== "") receive(object(JSON.parse(line) as unknown, "protocol message"));
        }
      } catch (cause) { fail(cause); }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr = `${stderr}${redact(chunk)}`.slice(-16_384); });
    child.stdin.on("error", fail);
    child.stdout.on("error", fail);
    child.stderr.on("error", fail);
    child.once("error", fail);
    child.once("close", (code, signal) => { if (!turnFinished) fail(new Error(`Codex exited before turn completion (${String(code)}, ${String(signal)}). ${stderr}`)); });
    const timer = setTimeout(() => fail(new Error(`Codex native turn exceeded ${request.timeoutMs} ms. ${stderr}`)), request.timeoutMs);
    let executionFailure: unknown;
    try {
      await rpc("initialize", { clientInfo: { name: "daynight-native-acceptance", version: "1" }, capabilities: { experimentalApi: true } });
      send({ method: "initialized", params: {} });
      await rpc("skills/list", { cwds: [request.workingDirectory], forceReload: true });
      const thread = await rpc("thread/start", { cwd: request.workingDirectory, ephemeral: true, approvalPolicy: "never", sandbox });
      const threadId = string(object(thread.thread, "started thread").id, "started thread id");
      await rpc("turn/start", { threadId, input: [{ type: "text", text: request.prompt, text_elements: [] }], sandboxPolicy: sandbox === "workspace-write" ? { type: "workspaceWrite", writableRoots: [request.fixtureDirectory, request.workingDirectory, request.homeDirectory, request.stateDirectory], networkAccess: true, excludeTmpdirEnvVar: true, excludeSlashTmp: true } : { type: "dangerFullAccess" } });
      await completed;
      result = { host: "codex", version, model: string(thread.model, "selected model"), sandbox, events, ...(usage === undefined ? {} : { usage }), finalText };
    } catch (cause) { executionFailure = cause; }
    clearTimeout(timer);
    try { await terminateInstalledProcess(child, closed); }
    catch (cause) { executionFailure = executionFailure === undefined ? cause : new AggregateError([executionFailure, cause], "Codex turn execution and process cleanup failed."); }
    if (executionFailure !== undefined) throw executionFailure;
  } catch (cause) { failure = cause; }
  try { await assertCodexNoCredentialFiles(home, credentials); }
  catch (cause) { failure = failure === undefined ? cause : new AggregateError([failure, cause], "Codex execution and credential-state verification failed."); }
  try { await rm(home, { recursive: true, force: true }); }
  catch (cause) { failure = failure === undefined ? cause : new AggregateError([failure, cause], "Codex execution and isolated-state cleanup failed."); }
  if (failure !== undefined) throw failure;
  if (result === undefined) throw new Error("Codex native execution produced no result.");
  return result;
};
