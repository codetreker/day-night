import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { formatError } from "./diagnostics.js";
import { createCopilotRunner } from "./copilot.js";
import { runCoordinator } from "./coordinator.js";
import { createGitManager } from "./git.js";
import { createGitHubClient } from "./github.js";
import { createProcessSupervisor } from "./processes.js";
import { openStore } from "./store.js";
import type { Configuration } from "./config.js";
import type { CoordinatorEvent } from "./coordinator.js";
import type { RuntimePaths } from "./paths.js";

export const acquireInstanceLock = async (lockFile: string, owner: string = randomUUID()) => {
  let file;
  try { file = await open(lockFile, "wx", 0o600); }
  catch (cause) {
    throw new Error(`Cannot acquire instance lock ${lockFile}. If a previous run stopped abnormally, first confirm that its CLI and all review agents have stopped, then manually remove the stale lock before restarting.`, { cause });
  }
  const content = JSON.stringify({ owner, pid: process.pid, startedAt: new Date().toISOString() });
  try { await file.writeFile(`${content}\n`); await file.sync(); }
  catch (error) {
    await file.close();
    await unlink(lockFile);
    throw error;
  }
  await file.close();
  let released = false;
  return {
    owner,
    release: async (): Promise<void> => {
      if (released) return;
      if ((await readFile(lockFile, "utf8")).trim() !== content) throw new Error(`Instance lock ${lockFile} no longer belongs to this CLI; it was retained.`);
      await unlink(lockFile);
      released = true;
    },
  };
};

export type RuntimeDependencies = {
  openStore: typeof openStore;
  createClient: typeof createGitHubClient;
  createGit: typeof createGitManager;
  createRunner: typeof createCopilotRunner;
  createProcesses: typeof createProcessSupervisor;
  coordinate: typeof runCoordinator;
};
const defaultDependencies: RuntimeDependencies = {
  openStore, createClient: createGitHubClient, createGit: createGitManager,
  createRunner: createCopilotRunner, createProcesses: createProcessSupervisor, coordinate: runCoordinator,
};

export const formatCoordinatorEvent = (event: CoordinatorEvent): string => {
  const identity = [event.repository, event.number === undefined ? undefined : `PR ${event.number}`,
    event.reviewId === undefined ? undefined : `review=${event.reviewId}`,
    event.revision === undefined ? undefined : `revision=${event.revision}`,
    event.attempt === undefined ? undefined : `attempt=${event.attempt}`].filter((value) => value !== undefined).join(" ");
  return `${identity === "" ? "" : `${identity} `}${event.phase}: ${event.message}${event.retryAt === undefined ? "" : ` retryAt=${new Date(event.retryAt).toISOString()}`}${event.error === undefined ? "" : `\n${formatError(event.error)}`}`;
};

export const runForegroundReview = async (
  configuration: Configuration,
  paths: RuntimePaths,
  options: { signal?: AbortSignal; log?: (event: CoordinatorEvent) => void; dependencies?: RuntimeDependencies } = {},
): Promise<void> => {
  const dependencies = options.dependencies === undefined ? defaultDependencies : options.dependencies;
  const log = options.log === undefined ? (event: CoordinatorEvent) => { process.stderr.write(`${formatCoordinatorEvent(event)}\n`); } : options.log;
  const controller = new AbortController();
  const stop = (): void => { controller.abort(); };
  const signals: NodeJS.Signals[] = process.platform === "win32" ? ["SIGINT", "SIGTERM", "SIGBREAK"] : ["SIGINT", "SIGTERM"];
  if (options.signal === undefined) for (const signal of signals) process.on(signal, stop);
  const signal = options.signal === undefined ? controller.signal : options.signal;
  let lock: Awaited<ReturnType<typeof acquireInstanceLock>> | undefined;
  let store: ReturnType<typeof openStore> | undefined;
  let safe = true;
  let failure: unknown;
  try {
    await mkdir(paths.stateDirectory, { recursive: true });
    lock = await acquireInstanceLock(paths.lockFile);
    signal.throwIfAborted();
    store = dependencies.openStore(paths.databaseFile);
    const client = dependencies.createClient();
    const git = dependencies.createGit({ temporaryDirectory: paths.temporaryDirectory, client });
    const processes = dependencies.createProcesses({ previousProcessesExcluded: true });
    const runner = dependencies.createRunner({ paths, processOwner: lock.owner, timeoutMs: configuration.agentTimeoutMs });
    log({ level: "info", phase: "startup", message: `Foreground review started; state=${paths.stateDirectory}.` });
    safe = false;
    const result = await dependencies.coordinate({ configuration, store, client, git, runner, processes, signal, log });
    safe = result.safeToReleaseLock && processes.safeToReleaseLock;
    if (!safe) throw new Error(`Review execution could not be confirmed stopped. Instance lock ${paths.lockFile} and interrupted state were retained; confirm the CLI and all review agents have stopped before manually removing the lock.`);
  } catch (error) { failure = error; }
  try { store?.close(); } catch (error) { safe = false; failure = failure === undefined ? error : new AggregateError([failure, error], "Review execution and database shutdown failed."); }
  if (lock !== undefined && safe) {
    try { await lock.release(); } catch (error) { failure = failure === undefined ? error : new AggregateError([failure, error], "Review execution and instance-lock release failed."); }
  }
  if (options.signal === undefined) for (const signal of signals) process.off(signal, stop);
  if (failure !== undefined) throw failure;
};
