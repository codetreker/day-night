import type { EventEmitter } from "node:events";
import { createApiClient, createOperation } from "../../api/index.js";
import type { ApiClient, Operation, OperationLimits } from "../../api/index.js";
import type { CliContext } from "../../cli/context.js";
import { resolveConfigurationPaths } from "../../config/paths.js";
import { loadServerConfiguration } from "../../config/server.js";

export type ServerSession = {
  readonly api: ApiClient;
  readonly operation: Operation;
  readonly serverUrl: string;
};

export type ServerCommand = (session: ServerSession) => Promise<string>;

export type ServerCommandOptions = {
  readonly signalEmitter?: Pick<EventEmitter, "on" | "off">;
  readonly platform?: NodeJS.Platform;
  readonly operationLimits?: Partial<OperationLimits>;
  readonly fetch?: typeof globalThis.fetch;
};

export const runServerCommand = async (
  context: CliContext,
  command: ServerCommand,
  options: ServerCommandOptions = {},
): Promise<void> => {
  const cancellation = new AbortController();
  const operation = createOperation({ signal: cancellation.signal, ...(options.operationLimits === undefined ? {} : { limits: options.operationLimits }) });
  const emitter = options.signalEmitter ?? process;
  const signals: NodeJS.Signals[] = (options.platform ?? process.platform) === "win32" ? ["SIGINT", "SIGTERM", "SIGBREAK"] : ["SIGINT", "SIGTERM"];
  const listeners: [NodeJS.Signals, () => void][] = [];
  let failed = false;
  let failure: unknown;
  try {
    for (const signal of signals) {
      const cancel = (): void => cancellation.abort(new Error(`Received ${signal}.`));
      emitter.on(signal, cancel);
      listeners.push([signal, cancel]);
    }
    operation.check();
    const paths = resolveConfigurationPaths(context.homeDirectory());
    const { serverUrl } = await loadServerConfiguration(paths, operation.signal);
    operation.check();
    const api = createApiClient({ serverUrl, operation, ...(options.fetch === undefined ? {} : { fetch: options.fetch }) });
    const output = await command({ api, operation, serverUrl });
    operation.check();
    context.stdout(output);
  } catch (cause) {
    failed = true;
    failure = cause;
    throw cause;
  } finally {
    const cleanup: unknown[] = [];
    for (const [signal, listener] of listeners) {
      try { emitter.off(signal, listener); }
      catch (cause) { cleanup.push(cause); }
    }
    try { operation.dispose(); }
    catch (cause) { cleanup.push(cause); }
    if (cleanup.length !== 0) throw new AggregateError(failed ? [failure, ...cleanup] : cleanup, "Server command or cancellation cleanup failed.");
  }
};
