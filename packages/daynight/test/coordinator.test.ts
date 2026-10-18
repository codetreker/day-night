import path from "node:path";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runCoordinator } from "../src/coordinator.js";
import type { CoordinatorEvent, CoordinatorOptions } from "../src/coordinator.js";
import { createCopilotRunner } from "../src/copilot.js";
import type { CopilotAttemptOutcome, CopilotRunOptions } from "../src/copilot.js";
import { createGitManager, GitCommandError } from "../src/git.js";
import type { LocalRepository, PreparedWorktree } from "../src/git.js";
import { executeCommand, GitHubApiError } from "../src/github.js";
import type { GitHubClient, GitHubRepository } from "../src/github.js";
import { resolveRuntimePaths } from "../src/paths.js";
import { createProcessSupervisor } from "../src/processes.js";
import { openStore } from "../src/store.js";
import type { PullRequestObservation, ReviewState, Store } from "../src/store.js";

const root = path.resolve(import.meta.dirname, "../../../.tmp/coordinator-tests");
const fixtures: { directory: string; store: Store; runs: { abort: AbortController; completion: Promise<{ safeToReleaseLock: boolean }> }[] }[] = [];
const proof = { processesExcluded: true, operationsStopped: true } as const;
const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const deferred = <T = void>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, refuse) => { resolve = accept; reject = refuse; });
  return { promise, resolve, reject };
};
const waitFor = async (condition: () => boolean, description: string, timeoutMs = 5_000): Promise<void> => {
  const until = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= until) throw new Error(`Timed out waiting for ${description}.`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};
const untilAborted = async (signal: AbortSignal): Promise<never> => {
  signal.throwIfAborted();
  await new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  throw new Error("Unreachable abort wait.");
};
const observation = (number: number, change: Partial<PullRequestObservation> = {}): PullRequestObservation => ({
  number, state: "open", draft: false, headSha: "a".repeat(40), baseRef: "main", baseSha: "b".repeat(40), ...change,
});

const fixture = (repositoryCount = 1, initialized = true) => {
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(path.join(root, "Coordinator 中文 "));
  const paths = resolveRuntimePaths(path.join(directory, "home"));
  mkdirSync(paths.stateDirectory, { recursive: true });
  const store = openStore(paths.databaseFile);
  const configurations = Array.from({ length: repositoryCount }, (_, index) => ({
    remote: `https://github.com/owner/repo${index}.git`, coordinate: `github.com/owner/repo${index}`, host: "github.com", owner: "owner", name: `repo${index}`, path: path.join(directory, `repo${index}`),
  }));
  const identities = configurations.map((config, index): GitHubRepository => ({ host: config.host, githubId: String(42 + index), owner: config.owner, name: config.name }));
  const snapshots = identities.map(() => new Map<number, PullRequestObservation>());
  const polls = identities.map(() => 0);
  const locals = configurations.map((configuration, index): LocalRepository => ({ configuration, repository: identities[index]!, root: configuration.path,
    commonDirectory: path.join(configuration.path, ".git"), rootIdentity: `root-${index}`, commonIdentity: `common-${index}` }));
  for (const [index, config] of configurations.entries()) {
    store.registerRepository({ ...identities[index]!, remote: config.remote, localPath: config.path });
    if (initialized) store.initializeRepository(identities[index]!, 0, Date.now());
  }
  const events: CoordinatorEvent[] = [];
  const prepared: ReviewState[] = [];
  const launched: { review: ReviewState; session: string; input: CopilotRunOptions }[] = [];
  const cleaned: number[] = [];
  let onPoll: ((index: number) => Promise<void>) | undefined;
  let onPrepare: ((review: ReviewState, signal: AbortSignal) => Promise<void>) | undefined;
  let onRun: ((review: ReviewState, input: CopilotRunOptions) => Promise<boolean>) | undefined;
  let onCleanup: ((pr: number) => Promise<void>) | undefined;
  const client: GitHubClient = {
    resolveRepository: async (config) => identities[configurations.findIndex((item) => item.name === config.name)]!,
    listPullRequestNumbers: async () => [],
    listOpenPullRequests: async (repository) => {
      const index = identities.findIndex((item) => item.githubId === repository.githubId);
      polls[index]!++;
      await onPoll?.(index);
      return [...snapshots[index]!.values()].filter((item) => item.state === "open").map((item) => ({ ...item }));
    },
    getPullRequest: async (repository, number) => ({ ...snapshots[identities.findIndex((item) => item.githubId === repository.githubId)]!.get(number)! }),
  };
  const git: CoordinatorOptions["git"] = {
    ensureRepository: async (config) => locals[configurations.findIndex((item) => item.name === config.name)]!,
    prepareWorktree: async (state, local, id, excluded, signal) => {
      expect(excluded.processesExcluded).toBe(true);
      const review = state.getReview(id)!;
      prepared.push(review);
      await onPrepare?.(review, signal!);
      signal?.throwIfAborted();
      const target = path.join(local.root, ".worktrees", `pr-${review.number}`);
      state.registerWorktree(review, target);
      state.pinReviewBase(id, state.getPullRequest(review)!.baseSha, Date.now());
      return { kind: "prepared", path: target, headSha: review.headSha, baseSha: state.getReview(id)!.baseSha!, mergeBaseSha: "c".repeat(40), gitEnvironment: {} };
    },
    cleanupWorktree: async (state, local, pr, excluded) => {
      expect(excluded).toEqual(proof);
      cleaned.push(pr.number);
      await onCleanup?.(pr.number);
      const current = state.getPullRequest(pr)!;
      if (current.state === "open") {
        state.cancelCleanup(pr, current.worktreePath!, excluded);
        return { kind: "reopened" };
      }
      state.completeCleanup(pr, current.worktreePath!, excluded);
      return { kind: "cleaned" };
    },
  };
  const runner: CoordinatorOptions["runner"] = { run: async (state, id, worktree, input = {}) => {
    const started = state.startAttempt(id, { processOwner: "fixture", stdoutLogPath: path.join(directory, `${id}-out`), stderrLogPath: path.join(directory, `${id}-err`) }, Date.now());
    launched.push({ review: started, session: state.getPullRequest(started)!.sessionId!, input });
    const completed = onRun === undefined ? true : await onRun(started, input);
    const outcome: CopilotAttemptOutcome = { attempt: { reviewId: id, attempt: started.attemptCount }, sessionId: state.getPullRequest(started)!.sessionId!, sessionMode: started.attemptCount === 1 ? "create" : "resume",
      stdoutLogPath: started.stdoutLogPath!, stderrLogPath: started.stderrLogPath!, completed, directProcessClosed: true, captureComplete: true,
      exitCode: 0, signal: null, lastNonemptyLine: completed ? `PR ${started.number} Review Completed` : "incomplete", interruption: null, launchFailure: null, errors: [] };
    expect(worktree.headSha).toBe(started.headSha);
    return outcome;
  } };
  const processes: CoordinatorOptions["processes"] = { onProcess: () => {}, stop: async () => {}, exclude: async () => proof, recover: async () => proof };
  const configuration = { pollIntervalMs: 20, maxConcurrentWorker: 1, agentTimeoutMs: 10_000, maxAttempts: 3, retryDelayMs: 20, repositories: configurations };
  const runs: { abort: AbortController; completion: Promise<{ safeToReleaseLock: boolean }> }[] = [];
  const start = (overrides: Partial<CoordinatorOptions> = {}) => {
    const abort = new AbortController();
    const completion = runCoordinator({ configuration, store, client, git, runner, processes, signal: abort.signal, log: (event) => { events.push(event); }, ...overrides });
    const run = { abort, completion };
    runs.push(run);
    return run;
  };
  const update = (number: number, change: Partial<PullRequestObservation> = {}, index = 0) => {
    snapshots[index]!.set(number, observation(number, { ...snapshots[index]!.get(number), ...change }));
  };
  const pr = (number = 1, index = 0) => ({ ...identities[index]!, number });
  const result = { directory, paths, store, configurations, identities, snapshots, polls, events, prepared, launched, cleaned, client, git, runner, processes, configuration, start, update, pr, runs,
    prepare: (handler: typeof onPrepare) => { onPrepare = handler; }, run: (handler: typeof onRun) => { onRun = handler; }, poll: (handler: typeof onPoll) => { onPoll = handler; }, cleanup: (handler: typeof onCleanup) => { onCleanup = handler; } };
  fixtures.push(result);
  return result;
};

afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    for (const run of f.runs) run.abort.abort(new Error("Test shutdown."));
    await Promise.all(f.runs.map((run) => run.completion));
    f.store.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});

describe("foreground review coordination", () => {
  it("initializes a permanent all-state cutoff before admitting later PRs", async () => {
    const f = fixture(1, false);
    f.client.listPullRequestNumbers = async () => [2, 9, 4];
    f.update(2); f.update(9); f.update(10);
    f.start();
    await waitFor(() => f.store.getPullRequest(f.pr(10))?.completedRevision === 1, "post-cutoff PR review");
    expect(f.store.getRepository(f.identities[0]!)?.startPrNumber).toBe(9);
    expect(f.store.getPullRequest(f.pr(2))).toBeNull();
    expect(f.store.getPullRequest(f.pr(9))).toBeNull();
    f.update(9, { headSha: "e".repeat(40), baseRef: "release" });
    const polls = f.polls[0]!;
    await waitFor(() => f.polls[0]! > polls + 1, "permanent cutoff scans");
    expect(f.launched.map((item) => item.review.number)).toEqual([10]);
    expect(f.events.some((event) => event.phase === "initialize" && event.message.includes("9"))).toBe(true);
  });

  it("reserves a PR before asynchronous preparation and holds the global slot through execution", async () => {
    const f = fixture();
    f.update(1); f.update(2);
    const prepare = deferred(); const execute = deferred<boolean>();
    f.prepare(async (review) => { if (review.number === 1) await prepare.promise; });
    f.run(async (review) => review.number === 1 ? execute.promise : true);
    f.start();
    await waitFor(() => f.prepared.length === 1 && f.polls[0]! >= 3, "polling during preparation");
    expect(f.store.listActiveReviews()).toHaveLength(1);
    expect(f.store.listActiveReviews()[0]?.status).toBe("preparing");
    expect(f.prepared.map((item) => item.number)).toEqual([1]);
    prepare.resolve();
    await waitFor(() => f.launched.length === 1 && f.polls[0]! >= 5, "polling during execution");
    expect(f.prepared).toHaveLength(1);
    execute.resolve(true);
    await waitFor(() => f.store.getPullRequest(f.pr(2))?.completedRevision === 1, "second PR after the first slot releases");
    expect(f.prepared.map((item) => item.number)).toEqual([1, 2]);
  });

  it("polls repositories independently while agents and another repository scan are delayed", async () => {
    const f = fixture(2); f.configuration.maxConcurrentWorker = 2;
    f.update(1, {}, 0); f.update(1, {}, 1);
    const scan = deferred(); const agent = deferred<boolean>();
    f.poll(async (index) => { if (index === 0) await scan.promise; });
    f.run(async () => agent.promise);
    f.start();
    await waitFor(() => f.polls[1]! >= 4 && f.launched.length === 1, "unblocked repository polling and review");
    expect(f.polls[0]).toBe(1);
    expect(f.launched[0]?.review.githubId).toBe(f.identities[1]!.githubId);
    scan.resolve(); agent.resolve(true);
    await waitFor(() => f.launched.length === 2 && f.store.listActiveReviews().length === 0, "both repository reviews");
  });

  it("admits waiting PRs before a continuously advancing PR's next revision", async () => {
    const f = fixture(2); f.configuration.pollIntervalMs = 2;
    f.update(1); f.update(2); f.update(3, {}, 1);
    let revision = 10;
    f.run(async (review) => {
      if (review.number === 1) f.update(1, { headSha: (++revision).toString(16).padStart(40, "0") });
      await new Promise((resolve) => setTimeout(resolve, 20));
      return true;
    });
    f.start();
    await waitFor(() => f.launched.filter((item) => item.review.number === 1).length >= 2, "hot PR successor after waiting PRs");
    const admitted = f.launched.map((item) => item.review.number);
    expect(admitted.slice(0, 3)).toEqual([1, 2, 3]);
    expect(admitted[3]).toBe(1);
    expect(f.store.getPullRequest(f.pr(2))?.completedRevision).toBe(1);
    expect(f.store.getPullRequest(f.pr(3, 1))?.completedRevision).toBe(1);
  });

  it("lets timers progress when every immediately completed poll is already due again", async () => {
    const f = fixture(); f.configuration.pollIntervalMs = 2;
    let timerFired = false;
    let timerProgressAtCap = false;
    const timer = setTimeout(() => { timerFired = true; }, 0);
    f.poll(async () => {
      if (f.polls[0] === 64) {
        timerProgressAtCap = timerFired;
        f.runs[0]!.abort.abort();
      }
    });
    let clock = Date.now();
    const run = f.start({ now: () => clock += 5 });
    try {
      await run.completion;
      expect(f.polls[0]).toBe(64);
      expect(timerProgressAtCap).toBe(true);
    } finally { clearTimeout(timer); }
  });

  it("cancels an in-flight poll after an internal fatal error without requiring an external abort", async () => {
    const f = fixture(2);
    const originalCandidates = f.store.listCandidates;
    const originalPoll = f.client.listOpenPullRequests;
    let polling = false;
    let pollStopped = false;
    let pollSignal: AbortSignal | undefined;
    f.client.listOpenPullRequests = async (repository, cutoff, signal) => {
      if (repository.githubId !== f.identities[0]!.githubId) return originalPoll(repository, cutoff, signal);
      polling = true; pollSignal = signal;
      try { return await untilAborted(signal!); }
      finally { pollStopped = true; }
    };
    f.store.listCandidates = (time) => {
      if (polling) throw new Error("SQLite selection failed.");
      return originalCandidates(time);
    };
    const run = f.start();
    const observed = run.completion.catch((error: unknown) => error);
    await waitFor(() => pollStopped, "fatal failure cancelling pending polling");
    expect(pollSignal?.aborted).toBe(true);
    expect(run.abort.signal.aborted).toBe(false);
    await expect(observed).resolves.toMatchObject({ message: "SQLite selection failed." });
    f.runs.splice(f.runs.indexOf(run), 1);
    f.store.listCandidates = originalCandidates;
    f.client.listOpenPullRequests = originalPoll;
  });

  it("coalesces head advances without cancelling a running captured revision or consuming its successor", async () => {
    const f = fixture(); f.update(1);
    const first = deferred<boolean>(); const second = deferred<boolean>();
    f.run(async (_review, _input) => f.launched.length === 1 ? first.promise : second.promise);
    f.start();
    await waitFor(() => f.launched.length === 1, "first captured target");
    f.update(1, { headSha: "d".repeat(40) });
    await waitFor(() => f.store.getPullRequest(f.pr())?.desiredRevision === 2, "first newer head");
    f.update(1, { headSha: "e".repeat(40) });
    await waitFor(() => f.store.getPullRequest(f.pr())?.desiredRevision === 3, "latest newer head");
    expect(f.launched[0]?.input.signal?.aborted).toBe(false);
    first.resolve(true);
    await waitFor(() => f.launched.length === 2, "coalesced latest target");
    expect(f.launched.map((item) => item.review.headSha)).toEqual(["a".repeat(40), "e".repeat(40)]);
    expect(f.launched[1]?.session).toBe(f.launched[0]?.session);
    expect(f.store.getPullRequest(f.pr())?.completedRevision).toBe(1);
    second.resolve(true);
    await waitFor(() => f.store.getPullRequest(f.pr())?.completedRevision === 3, "newest completion");
    f.update(1, { baseSha: "f".repeat(40) });
    await waitFor(() => f.store.getPullRequest(f.pr())?.baseSha === "f".repeat(40), "base tip observation");
    expect(f.launched).toHaveLength(2);
  });

  it("rechecks the target after preparation and launches only the latest ready target", async () => {
    const f = fixture(); f.update(1);
    const preparation = deferred();
    f.prepare(async () => { if (f.prepared.length === 1) await preparation.promise; });
    f.start();
    await waitFor(() => f.prepared.length === 1, "initial reservation");
    f.update(1, { baseRef: "release" });
    await waitFor(() => f.store.getPullRequest(f.pr())?.baseRef === "release", "changed target branch");
    preparation.resolve();
    await waitFor(() => f.store.getPullRequest(f.pr())?.completedRevision === 2, "new target branch review");
    expect(f.launched).toHaveLength(1);
    expect(f.launched[0]?.review.baseRef).toBe("release");
    expect(f.store.listReviews(f.pr()).map((item) => item.status).sort()).toEqual(["completed", "superseded"]);
    expect(f.launched[0]?.input.previousReview?.baseRef).toBe("main");
  });

  it("persists failed suppression across restart and grants a new budget only for a new trigger", async () => {
    const f = fixture(); f.configuration.maxAttempts = 2; f.update(1);
    f.run(async (review) => review.revision !== 1);
    const first = f.start();
    await waitFor(() => f.store.listReviews(f.pr())[0]?.status === "failed", "exhausted attempt budget");
    expect(f.launched).toHaveLength(2);
    expect(new Set(f.launched.map((item) => item.review.id)).size).toBe(1);
    expect(f.launched.map((item) => item.review.attemptCount)).toEqual([1, 2]);
    first.abort.abort(); await first.completion;
    const second = f.start();
    const previousPolls = f.polls[0]!;
    await waitFor(() => f.polls[0]! >= previousPolls + 3, "restart scans");
    expect(f.launched).toHaveLength(2);
    f.update(1, { headSha: "e".repeat(40) });
    await waitFor(() => f.store.getPullRequest(f.pr())?.completedRevision === 2, "new revision budget");
    expect(f.launched).toHaveLength(3);
    expect(f.launched[2]?.review.attemptCount).toBe(1);
    expect(f.launched[2]?.session).toBe(f.launched[0]?.session);
    expect(f.launched[2]?.input.previousReview?.id).toBe(f.launched[0]?.review.id);
    second.abort.abort();
  });

  it("persists exponential agent retry deadlines with a ten minute cap", async () => {
    const f = fixture(); f.configuration.retryDelayMs = 400_000; f.update(1);
    f.store.observePullRequest(f.identities[0]!, observation(1), 1);
    const review = f.store.reserveReview(f.pr(), { reviewId: uuid(1), sessionId: uuid(2), maxAttempts: 3 }, 1)!;
    f.store.registerWorktree(f.pr(), path.join(f.configurations[0]!.path, ".worktrees", "pr-1"));
    f.store.pinReviewBase(review.id, "b".repeat(40), 1);
    f.store.startAttempt(review.id, { processOwner: "prior", stdoutLogPath: "out", stderrLogPath: "err" }, 1);
    f.store.retryReview({ reviewId: review.id, attempt: 1 }, proof, { error: "previous incomplete", retryAt: 1 }, 1);
    f.run(async () => false);
    f.start();
    await waitFor(() => f.store.getReview(review.id)?.attemptCount === 2 && f.store.getReview(review.id)?.status === "retry_wait", "capped retry deadline");
    const retry = f.store.getReview(review.id)!;
    expect(retry.retryAt! - retry.updatedAt).toBe(600_000);
    expect(f.launched[0]?.review.id).toBe(review.id);
  });

  it("cancels observed Draft and closed PRs and serializes cleanup with reopening", async () => {
    const f = fixture(); f.update(1);
    f.run(async (_review, input) => untilAborted(input.signal!));
    let excludeCalls = 0;
    const exclusion = deferred();
    f.processes.exclude = async () => { excludeCalls++; if (excludeCalls === 2) await exclusion.promise; return proof; };
    const cleaning = deferred(); f.cleanup(async () => cleaning.promise);
    f.start();
    await waitFor(() => f.launched.length === 1, "first ready review");
    f.update(1, { draft: true });
    await waitFor(() => f.store.listReviews(f.pr())[0]?.status === "superseded", "Draft cancellation");
    expect(f.cleaned).toHaveLength(0);
    f.update(1, { draft: false });
    await waitFor(() => f.launched.length === 2, "Draft to ready review");
    f.update(1, { state: "closed" });
    await waitFor(() => excludeCalls === 2, "closed agent process exclusion");
    expect(f.cleaned).toHaveLength(0);
    exclusion.resolve();
    await waitFor(() => f.cleaned.length === 1, "serialized cleanup");
    f.update(1, { state: "open" });
    await waitFor(() => f.store.getPullRequest(f.pr())?.state === "open", "reopening during cleanup");
    expect(f.launched).toHaveLength(2);
    cleaning.resolve();
    await waitFor(() => f.launched.length === 3, "reopened review after cleanup release");
    expect(f.launched[2]?.session).toBe(f.launched[0]?.session);
  });

  it("does not complete an otherwise successful marker before process exclusion succeeds", async () => {
    const f = fixture(); f.update(1);
    const exclusion = deferred();
    f.processes.exclude = async () => { await exclusion.promise; throw new Error("A child remains live."); };
    const run = f.start();
    await waitFor(() => f.launched.length === 1, "completed direct agent");
    expect(f.store.getPullRequest(f.pr())?.completedRevision).toBe(0);
    exclusion.resolve();
    await waitFor(() => f.store.listReviews(f.pr())[0]?.status === "interrupted", "uncertain exclusion state");
    f.update(1, { headSha: "d".repeat(40) });
    await waitFor(() => f.store.getPullRequest(f.pr())?.desiredRevision === 2, "later target under uncertainty");
    expect(f.launched).toHaveLength(1);
    run.abort.abort();
    await expect(run.completion).resolves.toEqual({ safeToReleaseLock: false });
  });

  it("recovers old execution only after explicit proof and uses one advancing-clock recovery timestamp", async () => {
    const f = fixture(); f.update(1);
    f.store.observePullRequest(f.identities[0]!, observation(1), 1);
    const review = f.store.reserveReview(f.pr(), { reviewId: uuid(1), sessionId: uuid(2), maxAttempts: 3 }, 1)!;
    f.store.registerWorktree(f.pr(), path.join(f.configurations[0]!.path, ".worktrees", "pr-1"));
    f.store.pinReviewBase(review.id, "b".repeat(40), 1);
    f.store.startAttempt(review.id, { processOwner: "old", stdoutLogPath: "old-out", stderrLogPath: "old-err" }, 1);
    f.store.recordProcess({ reviewId: review.id, attempt: 1 }, { pid: 1234, identity: "old:1" });
    const recovery = deferred();
    f.processes.recover = async () => { await recovery.promise; return proof; };
    let time = Date.now();
    f.start({ now: () => ++time });
    await waitFor(() => f.store.getReview(review.id)?.status === "interrupted", "persisted uncertainty before proof");
    expect(f.launched).toHaveLength(0);
    recovery.resolve();
    await waitFor(() => f.store.getReview(review.id)?.status === "completed", "recovered target confirmation");
    expect(f.launched[0]?.review.id).toBe(review.id);
    expect(f.launched[0]?.review.attemptCount).toBe(2);
    expect(f.events.some((event) => event.phase === "recovery")).toBe(true);
  });

  it("retains a startup preparation whose process and operation exclusion cannot be confirmed", async () => {
    const f = fixture(); f.update(1);
    f.store.observePullRequest(f.identities[0]!, observation(1), 1);
    const old = f.store.reserveReview(f.pr(), { reviewId: uuid(1), sessionId: uuid(2), maxAttempts: 3 }, 1)!;
    f.processes.recover = async () => { throw new Error("Operator recovery proof is missing."); };
    const run = f.start();
    await waitFor(() => f.polls[0]! >= 3, "polls around blocked recovery");
    expect(f.store.getReview(old.id)?.status).toBe("interrupted");
    expect(f.launched).toHaveLength(0);
    expect(f.prepared).toHaveLength(0);
    run.abort.abort(); await expect(run.completion).resolves.toEqual({ safeToReleaseLock: false });
  });

  it("keeps failed cleanup pending and retries it while admitting reviews for other PRs", async () => {
    const f = fixture(); f.update(1);
    let failed = false;
    f.cleanup(async () => {
      if (!failed) {
        failed = true;
        const pr = f.store.getPullRequest(f.pr())!;
        f.store.recordCleanupError(pr, pr.worktreePath!, "sharing violation");
        throw new Error("sharing violation");
      }
    });
    f.start();
    await waitFor(() => f.store.getPullRequest(f.pr())?.completedRevision === 1, "review before closure");
    f.update(1, { state: "closed" }); f.update(2);
    await waitFor(() => f.events.some((event) => event.phase === "cleanup" && event.level === "error"), "persisted cleanup failure");
    await waitFor(() => f.store.getPullRequest(f.pr())?.worktreePath === null && f.store.getPullRequest(f.pr(2))?.completedRevision === 1, "cleanup retry and independent review");
    expect(f.cleaned).toEqual([1, 1]);
    expect(f.store.getPullRequest(f.pr())?.cleanupError).toBeNull();
  });

  it("preserves old cleanup across unconfirmed restarts and reopening while other repositories run", async () => {
    const f = fixture(2);
    f.store.observePullRequest(f.identities[0]!, observation(1), 1);
    f.store.registerWorktree(f.pr(), path.join(f.configurations[0]!.path, ".worktrees", "pr-1"));
    f.store.observePullRequest(f.identities[0]!, observation(1, { state: "closed" }), 2);
    f.update(1);
    f.update(3);
    f.update(2, {}, 1);
    f.processes.recover = async () => { throw new Error("Old cleanup processes have not been excluded."); };
    const first = f.start();
    await waitFor(() => f.store.getPullRequest(f.pr(2, 1))?.completedRevision === 1, "independent repository review");
    await waitFor(() => f.store.getPullRequest(f.pr(3))?.completedRevision === 1, "independent PR in the same repository");
    expect(f.polls[0]).toBeGreaterThan(0);
    expect(f.cleaned).toEqual([]);
    expect(f.store.getPullRequest(f.pr())?.cleanupPending).toBe(true);
    expect(f.store.getPullRequest(f.pr())?.state).toBe("open");
    first.abort.abort();
    await expect(first.completion).resolves.toEqual({ safeToReleaseLock: false });

    const second = f.start();
    const previousPolls = f.polls[1]!;
    await waitFor(() => f.polls[1]! > previousPolls + 1, "polling during another unconfirmed restart");
    expect(f.prepared.map((review) => review.number).sort()).toEqual([2, 3]);
    expect(f.store.getPullRequest(f.pr())?.cleanupPending).toBe(true);
    second.abort.abort();
    await expect(second.completion).resolves.toEqual({ safeToReleaseLock: false });

    f.processes.recover = async () => proof;
    const confirmed = f.start();
    await waitFor(() => f.store.getPullRequest(f.pr())?.completedRevision === 2, "reopened PR after explicit recovery proof");
    expect(f.cleaned).toEqual([1]);
    confirmed.abort.abort();
    await expect(confirmed.completion).resolves.toEqual({ safeToReleaseLock: true });
  });

  it("retains cleanup uncertainty when a PR reopens before removal fails and blocks reuse after automatic restart", async () => {
    const f = fixture(2);
    f.update(1);
    const removal = deferred();
    f.cleanup(async () => removal.promise);
    const original = f.start();
    await waitFor(() => f.store.getPullRequest(f.pr())?.completedRevision === 1, "review before cleanup");
    f.update(1, { state: "closed" });
    await waitFor(() => f.cleaned.length === 1, "in-flight removal");
    f.update(1, { state: "open" });
    await waitFor(() => f.store.getPullRequest(f.pr())?.state === "open", "reopening before removal result");
    expect(f.store.getPullRequest(f.pr())?.cleanupPending).toBe(true);
    expect(f.launched).toHaveLength(1);
    removal.reject(new GitCommandError("Removal outcome is uncertain.", new Error("capture abandoned"), false));
    await waitFor(() => f.events.some((event) => event.phase === "cleanup" && event.level === "error"), "uncertain removal diagnostic");
    original.abort.abort();
    await expect(original.completion).resolves.toEqual({ safeToReleaseLock: false });
    const persisted = openStore(f.paths.databaseFile);
    try {
      expect(persisted.getPullRequest(f.pr())).toMatchObject({ state: "open", cleanupPending: true });
      expect(persisted.listActiveReviews()).toEqual([]);
      expect(persisted.listCleanupCandidates().map((pr) => pr.number)).toEqual([1]);
    } finally { persisted.close(); }

    f.update(2, {}, 1);
    const restarted = f.start({ processes: createProcessSupervisor() });
    await waitFor(() => f.store.getPullRequest(f.pr(2, 1))?.completedRevision === 1, "independent review after automatic restart");
    expect(f.prepared.map((review) => review.number)).toEqual([1, 2]);
    expect(f.cleaned).toEqual([1]);
    expect(f.store.getPullRequest(f.pr())?.cleanupPending).toBe(true);
    restarted.abort.abort();
    await expect(restarted.completion).resolves.toEqual({ safeToReleaseLock: false });

    f.cleanup(undefined);
    const confirmed = f.start();
    await waitFor(() => f.store.getPullRequest(f.pr())?.completedRevision === 2, "reopened review after explicit exclusion");
    expect(f.store.getPullRequest(f.pr())?.cleanupPending).toBe(false);
    confirmed.abort.abort();
    await expect(confirmed.completion).resolves.toEqual({ safeToReleaseLock: true });
  });

  it("defers an ordinary preparation failure without spending an attempt, but blocks uncertain Git execution", async () => {
    const f = fixture(); f.update(1); f.update(2);
    let first = true;
    f.prepare(async (review) => {
      if (review.number === 2) throw new GitCommandError("Command outcome uncertain.", new Error("timeout"), false);
      if (first) { first = false; throw new Error("ordinary preparation failure"); }
    });
    const run = f.start();
    await waitFor(() => f.store.listReviews(f.pr(1))[0]?.status === "completed" && f.store.listReviews(f.pr(2))[0]?.status === "interrupted", "preparation outcomes");
    expect(f.store.listReviews(f.pr(1))[0]?.attemptCount).toBe(1);
    expect(f.prepared.filter((review) => review.number === 1)).toHaveLength(2);
    expect(f.launched.map((item) => item.review.number)).toEqual([1]);
    expect(f.store.listReviews(f.pr(2))[0]?.attemptCount).toBe(0);
    run.abort.abort(); await expect(run.completion).resolves.toEqual({ safeToReleaseLock: false });
  });

  it("waits for shutdown cancellation and process exclusion before returning", async () => {
    const f = fixture(); f.update(1);
    f.run(async (_review, input) => untilAborted(input.signal!));
    const exclusion = deferred(); let excluding = false;
    f.processes.exclude = async () => { excluding = true; await exclusion.promise; return proof; };
    const run = f.start();
    await waitFor(() => f.launched.length === 1, "running agent");
    run.abort.abort(new Error("shutdown"));
    await waitFor(() => excluding, "shutdown process exclusion");
    let returned = false; void run.completion.then(() => { returned = true; });
    expect(returned).toBe(false);
    expect(f.store.listReviews(f.pr())[0]?.status).toBe("running");
    exclusion.resolve();
    await expect(run.completion).resolves.toEqual({ safeToReleaseLock: true });
    expect(f.store.listReviews(f.pr())[0]?.status).toBe("retry_wait");
  });

  it("rejects duplicate stable GitHub identities before rebinding durable local state", async () => {
    const f = fixture(2);
    const originalEnsure = f.git.ensureRepository;
    f.git.ensureRepository = async (config, signal) => {
      const local = await originalEnsure(config, signal);
      return { ...local, repository: { ...local.repository, githubId: "42" } };
    };
    f.start();
    await waitFor(() => f.events.some((event) => event.level === "error" && String(event.error).includes("same GitHub repository")), "duplicate stable identity error");
    expect(f.store.getRepository(f.identities[0]!)?.localPath).toBe(f.configurations[0]!.path);
    expect(f.polls[1]).toBe(0);
  });

  it("honors repository API cooldown without blocking another host or admitting partial observations", async () => {
    const f = fixture(2);
    const cooldown = Date.now() + 150;
    let first = true;
    f.poll(async (index) => { if (index === 0 && first) { first = false; throw new GitHubApiError("rate limited", { status: 429, retryAt: cooldown }); } });
    f.start();
    await waitFor(() => f.polls[1]! >= 3, "other repository scans during cooldown");
    expect(f.polls[0]).toBe(1);
    expect(f.store.getRepository(f.identities[0]!)?.lastPollError).toContain("rate limited");
    await waitFor(() => f.polls[0]! >= 2, "cooldown expiry");
    expect(f.store.getRepository(f.identities[0]!)?.lastPollError).toBeNull();
  });
});

const nativeGit = (directory: string, args: string[], input?: string): string => execFileSync("git", ["-C", directory, ...args], {
  encoding: "utf8", timeout: 20_000, env: Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith("GIT_"))),
  ...(input === undefined ? {} : { input }), stdio: ["pipe", "pipe", "pipe"],
}).trim();
const commit = (directory: string, value: string, parent?: string): string => {
  const blob = nativeGit(directory, ["hash-object", "-w", "--stdin"], value);
  const attributes = nativeGit(directory, ["hash-object", "-w", "--stdin"], "* -text\n");
  const tree = nativeGit(directory, ["mktree"], `100644 blob ${attributes}\t.gitattributes\n100644 blob ${blob}\tfile.txt\n`);
  return nativeGit(directory, ["hash-object", "-t", "commit", "-w", "--stdin"], `tree ${tree}\n${parent === undefined ? "" : `parent ${parent}\n`}author Fixture <fixture@example.invalid> 1700000000 +0000\ncommitter Fixture <fixture@example.invalid> 1700000000 +0000\n\nfixture\n`);
};

describe("coordinator real Git, SQLite and controlled agent lifecycle", () => {
  it("clones, reviews exact worktree revisions in one session, and cleans the closed PR", async () => {
    const f = fixture(); f.configuration.pollIntervalMs = 30;
    const upstream = path.join(f.directory, "source.git"); mkdirSync(upstream);
    nativeGit(upstream, ["init", "--bare", "--initial-branch=main"]);
    const base = commit(upstream, "base\n"); const first = commit(upstream, "first PR\n", base); const second = commit(upstream, "second PR\n", first);
    nativeGit(upstream, ["update-ref", "refs/heads/main", base]); nativeGit(upstream, ["update-ref", "refs/pull/1/head", first]);
    f.update(1, { headSha: first, baseSha: base });
    const git = createGitManager({ temporaryDirectory: f.paths.temporaryDirectory, client: f.client, execute: async (file, args, options) => {
      if (file === "gh") return { stdout: "fixture-only-secret\n", stderr: "", error: null };
      return executeCommand(file, ["-c", "protocol.file.allow=always", "-c", `url.${pathToFileURL(upstream).href}.insteadOf=${f.configurations[0]!.remote}`, ...args], options);
    } });
    const report = path.join(f.directory, "agent-report.jsonl"); const script = path.join(f.directory, "review-agent.mjs");
    writeFileSync(script, `import path from 'node:path';import{mkdirSync,writeFileSync,appendFileSync,readFileSync}from'node:fs';import{execFileSync}from'node:child_process';
let prompt='';for await(const part of process.stdin)prompt+=part;const args=process.argv.slice(2);const option=args.find(x=>x.startsWith('--session-id=')||x.startsWith('--resume='));const session=option.split('=')[1];
mkdirSync(path.join(process.env.COPILOT_HOME,'session-state',session),{recursive:true});writeFileSync(path.join(process.env.COPILOT_HOME,'session-state',session,'opaque.jsonl'),'opaque');
const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();appendFileSync(process.env.FIXTURE_REPORT,JSON.stringify({session,option,sha,contents:readFileSync('file.txt','utf8'),prompt})+'\\n');process.stdout.write('PR 1 Review Completed\\n');`);
    const runner = createCopilotRunner({ paths: f.paths, processOwner: uuid(900), timeoutMs: 10_000, terminationGraceMs: 100,
      command: { file: process.execPath, args: [script] }, environment: { ...process.env, FIXTURE_REPORT: report } });
    f.start({ git, runner, processes: createProcessSupervisor({ graceMs: 500, previousProcessesExcluded: true }) });
    await waitFor(() => f.store.getPullRequest(f.pr())?.completedRevision === 1, "first real review", 30_000);
    const target = path.join(f.configurations[0]!.path, ".worktrees", "pr-1");
    expect(nativeGit(target, ["rev-parse", "HEAD"])).toBe(first);
    writeFileSync(path.join(target, "generated.txt"), "discarded on next revision");
    nativeGit(upstream, ["update-ref", "refs/pull/1/head", second]); f.update(1, { headSha: second });
    await waitFor(() => f.store.getPullRequest(f.pr())?.completedRevision === 2, "second real review", 30_000);
    const reports = readFileSync(report, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { session: string; option: string; sha: string; contents: string; prompt: string });
    expect(reports.map((item) => item.sha)).toEqual([first, second]);
    expect(reports.map((item) => item.contents)).toEqual(["first PR\n", "second PR\n"]);
    expect(reports[1]?.session).toBe(reports[0]?.session);
    expect(reports[0]?.option).toMatch(/^--session-id=/); expect(reports[1]?.option).toMatch(/^--resume=/);
    expect(existsSync(path.join(target, "generated.txt"))).toBe(false);
    expect(nativeGit(f.configurations[0]!.path, ["rev-parse", "HEAD"])).toBe(base);
    f.update(1, { state: "merged" });
    await waitFor(() => f.store.getPullRequest(f.pr())?.worktreePath === null, "real worktree cleanup", 30_000);
    expect(existsSync(target)).toBe(false);
    expect(existsSync(path.join(f.paths.copilotDirectory, "session-state", reports[0]!.session))).toBe(true);
    expect(f.events.filter((event) => event.phase === "completed")).toHaveLength(2);
  }, 90_000);
});
