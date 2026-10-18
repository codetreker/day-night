import { randomUUID } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import type { ChildProcess } from "node:child_process";
import type { Configuration, RepositoryConfiguration } from "./config.js";
import type { CopilotAttemptOutcome, CopilotRunOptions, createCopilotRunner } from "./copilot.js";
import { GitCommandError } from "./git.js";
import type { LocalRepository, createGitManager } from "./git.js";
import { GitHubApiError, pollRepository } from "./github.js";
import type { GitHubClient } from "./github.js";
import type { AttemptIdentity, OperationsStopped, ProcessesExcluded, PullRequestIdentity, PullRequestState, ReviewCandidate, ReviewState, Store } from "./store.js";

export type CoordinatorEvent = {
  level: "info" | "error";
  phase: string;
  message: string;
  repository?: string;
  number?: number;
  reviewId?: string;
  revision?: number;
  attempt?: number;
  retryAt?: number;
  error?: unknown;
};
export type CoordinatorProcesses = {
  onProcess: (child: ChildProcess, attempt: AttemptIdentity) => void;
  stop: (child: ChildProcess, attempt: AttemptIdentity) => Promise<void>;
  exclude: (review: ReviewState, outcome?: CopilotAttemptOutcome) => Promise<ProcessesExcluded>;
  recover: (review?: ReviewState) => Promise<ProcessesExcluded & OperationsStopped>;
};
export type CoordinatorOptions = {
  configuration: Configuration;
  store: Store;
  client: GitHubClient;
  git: ReturnType<typeof createGitManager>;
  runner: Pick<ReturnType<typeof createCopilotRunner>, "run">;
  processes: CoordinatorProcesses;
  signal: AbortSignal;
  log: (event: CoordinatorEvent) => void;
  now?: () => number;
};

type RepositoryWork = { configuration: RepositoryConfiguration; local: LocalRepository | null; polling: boolean; nextPollAt: number; blocked: boolean };
type Reservation = { kind: "review" | "cleanup"; controller: AbortController; reviewId?: string };
type CheckAdmission = { target: string; checking: boolean; ready: boolean; nextCheckAt: number; reported: boolean };
const key = (identity: PullRequestIdentity): string => JSON.stringify([identity.host, identity.githubId, identity.number]);
const target = (pr: PullRequestState): string => JSON.stringify([pr.desiredRevision, pr.headSha, pr.baseRef]);
const repositoryKey = (identity: { host: string; githubId: string }): string => JSON.stringify([identity.host, identity.githubId]);
const message = (error: unknown): string => error instanceof Error ? error.message : String(error);
const isCurrent = (review: ReviewState, pr: PullRequestState): boolean => pr.state === "open" && !pr.draft && !pr.cleanupPending &&
  review.revision === pr.desiredRevision && review.headSha === pr.headSha && review.baseRef === pr.baseRef;
const uncertainGit = (error: unknown): boolean => {
  if (error instanceof GitCommandError && !error.completed) return true;
  if (error instanceof AggregateError && error.errors.some(uncertainGit)) return true;
  return error instanceof Error && error.cause !== undefined && uncertainGit(error.cause);
};
const stopped = { operationsStopped: true } as const;
const excluded = { processesExcluded: true } as const;
const retryDelay = (configuration: Configuration, attempts: number): number => Math.min(600_000, configuration.retryDelayMs * 2 ** Math.min(30, Math.max(0, attempts - 1)));

/** Owns one foreground scheduling lifetime; dependencies retain command and process ownership. */
export const runCoordinator = async (options: CoordinatorOptions): Promise<{ safeToReleaseLock: boolean }> => {
  const { configuration, store, client, git, runner, processes, log } = options;
  const lifetime = new AbortController();
  const signal = AbortSignal.any([options.signal, lifetime.signal]);
  const now = options.now === undefined ? Date.now : options.now;
  const repositories: RepositoryWork[] = configuration.repositories.map((item) => ({ configuration: item, local: null, polling: false, nextPollAt: 0, blocked: false }));
  const localRepositories = new Map<string, RepositoryWork>();
  const reservations = new Map<string, Reservation>();
  const blocked = new Set<string>();
  const cleanupRetryAt = new Map<string, number>();
  const waiting = new Map<string, ReviewCandidate>();
  const checkAdmissions = new Map<string, CheckAdmission>();
  const pending = new Set<Promise<void>>();
  let workers = 0;
  let safeToReleaseLock = true;
  let wake: (() => void) | undefined;
  const notify = (): void => { wake?.(); };
  const context = (review: ReviewState): Pick<CoordinatorEvent, "repository" | "number" | "reviewId" | "revision" | "attempt"> => {
    const repository = store.getRepository(review);
    return { repository: repository === null ? `${review.host}/${review.githubId}` : repository.remote, number: review.number,
      reviewId: review.id, revision: review.revision, attempt: review.attemptCount };
  };
  const report = (review: ReviewState, phase: string, text: string, error?: unknown, retryAt?: number): void => {
    log({ ...context(review), phase, message: text, level: error === undefined ? "info" : "error",
      ...(error === undefined ? {} : { error }), ...(retryAt === undefined ? {} : { retryAt }) });
  };
  const interrupt = (review: ReviewState, error: unknown): void => {
    blocked.add(key(review));
    safeToReleaseLock = false;
    const current = store.getReview(review.id)!;
    if (current.status === "preparing" || current.status === "running" || current.status === "interrupted") store.markInterrupted(current.id, message(error), now());
    report(current, "interrupted", "The PR is blocked until its previous operations and processes are explicitly excluded.", error);
  };
  const track = (operation: () => Promise<void>, release: () => void): void => {
    const task = operation().catch((error: unknown) => {
      safeToReleaseLock = false;
      log({ level: "error", phase: "coordinator", message: "An operation failed while recording its final state; retained state requires inspection.", error });
    }).finally(() => { release(); pending.delete(task); notify(); });
    pending.add(task);
  };
  const checksRetryAt = (error?: unknown): number => Math.max(now() + configuration.pollIntervalMs,
    error instanceof GitHubApiError && error.retryAt !== null ? error.retryAt : 0);
  const checkCandidate = async (repository: RepositoryWork, pr: PullRequestState, admission: CheckAdmission): Promise<void> => {
    const prKey = key(pr);
    try {
      const checks = await client.getPullRequestChecks(repository.local!.repository, pr.number, signal);
      const candidate = waiting.get(prKey);
      if (signal.aborted || checkAdmissions.get(prKey) !== admission || candidate === undefined || target(candidate.pullRequest) !== admission.target) return;
      const ready = checks.ready && checks.headSha === pr.headSha && checks.baseRef === pr.baseRef;
      if (!admission.reported || admission.ready !== ready) log({ level: "info", phase: "ci", repository: repository.configuration.coordinate,
        number: pr.number, revision: pr.desiredRevision, message: ready ? "All CI checks passed for the waiting PR target." : "The PR is waiting for all CI checks to finish and pass." });
      admission.ready = ready;
      admission.reported = true;
      admission.nextCheckAt = checksRetryAt();
    } catch (error) {
      if (signal.aborted || checkAdmissions.get(prKey) !== admission) return;
      admission.ready = false;
      admission.nextCheckAt = checksRetryAt(error);
      log({ level: "error", phase: "ci", repository: repository.configuration.coordinate, number: pr.number, revision: pr.desiredRevision,
        message: "CI checks could not be read; review admission remains closed.", error, retryAt: admission.nextCheckAt });
    }
  };
  const cancelIneligible = (): void => {
    for (const [prKey, reservation] of reservations) {
      if (reservation.kind !== "review" || reservation.reviewId === undefined) continue;
      const review = store.getReview(reservation.reviewId)!;
      const pr = store.getPullRequest(review)!;
      if (pr.state !== "open" || pr.draft) reservation.controller.abort(new Error(`PR ${pr.number} is ${pr.state !== "open" ? pr.state : "Draft"}.`));
      if (blocked.has(prKey)) reservation.controller.abort(new Error("The PR has unresolved operations."));
    }
    for (const review of store.listActiveReviews()) {
      if (review.status !== "retry_wait" || reservations.has(key(review)) || blocked.has(key(review))) continue;
      if (!isCurrent(review, store.getPullRequest(review)!)) {
        store.supersedeReview(review.id, stopped, now());
        report(review, "superseded", "The waiting review was replaced by the latest observed PR state.");
      }
    }
  };

  for (const pr of store.listCleanupCandidates()) {
    try { await processes.recover(); }
    catch (error) {
      const retainedRepository = store.getRepository(pr)!;
      blocked.add(key(pr));
      safeToReleaseLock = false;
      log({ level: "error", phase: "recovery", repository: retainedRepository.remote, number: pr.number,
        message: "The PR's cleanup and worktree reuse are blocked until its previous operations and processes are explicitly excluded.", error });
    }
  }

  // Persist uncertainty before requesting the runtime's explicit startup recovery proof.
  for (const review of store.listActiveReviews()) {
    if (review.status === "retry_wait") continue;
    const interrupted = store.markInterrupted(review.id, "A previous coordinator stopped before this operation was resolved.", now());
    try {
      const proof = await processes.recover(interrupted);
      const recoveredAt = now();
      const recovered = store.resolveInterrupted(interrupted.id, proof, recoveredAt, recoveredAt);
      report(recovered, "recovery", "Previous processes and operations were excluded; the persisted target may be reconciled.");
    } catch (error) { interrupt(interrupted, error); }
  }

  const poll = async (repository: RepositoryWork): Promise<void> => {
    try {
      if (repository.local === null) {
        repository.local = await git.ensureRepository(repository.configuration, signal);
        const existing = localRepositories.get(repositoryKey(repository.local.repository));
        if (existing !== undefined && existing !== repository) {
          repository.blocked = true;
          throw new Error(`Configured repository ${repository.configuration.coordinate} resolves to the same GitHub repository as ${existing.configuration.coordinate}.`);
        }
        localRepositories.set(repositoryKey(repository.local.repository), repository);
        log({ level: "info", phase: "repository", repository: repository.configuration.coordinate, message: "The dedicated review clone is ready." });
      }
      const previous = store.getRepository(repository.local.repository);
      const pollingClient: GitHubClient = { ...client, resolveRepository: async (input, abortSignal) => {
        const resolved = await client.resolveRepository(input, abortSignal);
        if (repositoryKey(resolved) !== repositoryKey(repository.local!.repository)) {
          repository.blocked = true;
          throw new Error(`Configured repository ${repository.configuration.coordinate} changed its stable GitHub identity after clone validation.`);
        }
        return resolved;
      } };
      const observed = await pollRepository(store, repository.configuration, pollingClient, { now, signal });
      if (previous === null || previous.startPrNumber === null) log({ level: "info", phase: "initialize", repository: repository.configuration.coordinate,
        message: `Permanently excluding PR numbers through ${observed.startPrNumber}.` });
      cancelIneligible();
      repository.nextPollAt = now() + configuration.pollIntervalMs;
    } catch (error) {
      if (uncertainGit(error)) { repository.blocked = true; safeToReleaseLock = false; }
      const retryAt = Math.max(now() + configuration.pollIntervalMs, error instanceof GitHubApiError && error.retryAt !== null ? error.retryAt : 0);
      repository.nextPollAt = retryAt;
      if (!signal.aborted || uncertainGit(error)) log({ level: "error", phase: "poll", repository: repository.configuration.coordinate,
        message: repository.blocked ? "Repository preparation is blocked and requires intervention." : "Repository polling failed; the previous complete observation remains in effect.", error, retryAt });
    }
  };
  const endAttempt = async (review: ReviewState, outcome: CopilotAttemptOutcome | undefined, error: unknown, aborted: boolean): Promise<void> => {
    let proof: ProcessesExcluded;
    try { proof = await processes.exclude(review, outcome); } catch (exclusionError) { interrupt(review, new AggregateError(error === undefined ? [exclusionError] : [error, exclusionError], "Agent processes could not be excluded.")); return; }
    const time = now();
    if (outcome?.completed === true && !aborted) {
      const completed = store.completeReview(outcome.attempt, proof, time);
      report(completed, "completed", "The exact completion marker was accepted after all managed agent processes stopped.");
      return;
    }
    const reason = error === undefined ? new Error(`Copilot review did not complete: exit=${outcome?.exitCode}, signal=${outcome?.signal}, interruption=${outcome?.interruption}; ${outcome?.errors.map(message).join("; ")}`) : error;
    const retryAt = time + retryDelay(configuration, review.attemptCount);
    let ended: ReviewState;
    if (aborted) {
      store.markInterrupted(review.id, message(reason), time);
      ended = store.resolveInterrupted(review.id, { ...proof, ...stopped }, retryAt, time);
    } else ended = store.retryReview({ reviewId: review.id, attempt: review.attemptCount }, proof, { error: message(reason), retryAt }, time);
    report(ended, ended.status, ended.status === "failed" ? "The captured revision exhausted its attempt budget and remains suppressed." : "The incomplete attempt was retained for reconciliation or superseded by the latest target.", reason,
      ended.retryAt === null ? undefined : ended.retryAt);
  };
  const reviewPullRequest = async (repository: RepositoryWork, review: ReviewState, reservation: Reservation): Promise<void> => {
    try {
      const local = repository.local!;
      const worktree = await git.prepareWorktree(store, local, review.id, excluded, reservation.controller.signal);
      if (worktree.kind === "changed") {
        store.supersedeReview(review.id, stopped, now());
        report(review, "superseded", "The PR target changed while its worktree was being prepared.");
        return;
      }
      reservation.controller.signal.throwIfAborted();
      const observation = await client.getPullRequest(local.repository, review.number, reservation.controller.signal);
      const pr = store.observePullRequest(local.repository, observation, now())!;
      cancelIneligible();
      if (!isCurrent(store.getReview(review.id)!, pr)) {
        store.supersedeReview(review.id, stopped, now());
        report(review, "superseded", "The captured target is no longer ready immediately before agent launch.");
        return;
      }
      let checks: Awaited<ReturnType<GitHubClient["getPullRequestChecks"]>>;
      try { checks = await client.getPullRequestChecks(local.repository, review.number, reservation.controller.signal); }
      catch (error) {
        reservation.controller.signal.throwIfAborted();
        const time = now();
        const deferred = store.deferPreparation(review.id, stopped, { error: message(error), retryAt: checksRetryAt(error) }, time);
        report(deferred, "ci", "CI checks could not be revalidated before agent launch; no agent attempt was consumed.", error,
          deferred.retryAt === null ? undefined : deferred.retryAt);
        return;
      }
      reservation.controller.signal.throwIfAborted();
      if (!isCurrent(store.getReview(review.id)!, store.getPullRequest(review)!)) {
        store.supersedeReview(review.id, stopped, now());
        report(review, "superseded", "The PR target changed while its CI checks were being revalidated.");
        return;
      }
      if (!checks.ready || checks.headSha !== review.headSha || checks.baseRef !== review.baseRef) {
        const time = now();
        const deferred = store.deferPreparation(review.id, stopped, { error: "The captured PR target no longer has passing CI checks.", retryAt: checksRetryAt() }, time);
        report(deferred, "ci", "The PR is waiting for passing CI checks before agent launch; no agent attempt was consumed.", undefined,
          deferred.retryAt === null ? undefined : deferred.retryAt);
        return;
      }
      const previous = store.listReviews(review).filter((item) => item.id !== review.id && item.status !== "completed").at(-1);
      const input: CopilotRunOptions = { signal: reservation.controller.signal, onProcess: processes.onProcess, stopProcess: processes.stop,
        ...(previous === undefined ? {} : { previousReview: previous }) };
      report(review, "launch", "Launching the PR's persisted Copilot session.");
      const outcome = await runner.run(store, review.id, worktree, input);
      const current = store.getReview(review.id)!;
      await endAttempt(current, outcome, undefined, reservation.controller.signal.aborted);
    } catch (error) {
      const current = store.getReview(review.id)!;
      if (uncertainGit(error)) { interrupt(current, error); return; }
      if (current.status === "running") { await endAttempt(current, undefined, error, reservation.controller.signal.aborted); return; }
      if (current.status !== "preparing") throw error;
      const time = now();
      const retryAt = time + retryDelay(configuration, current.attemptCount);
      const deferred = store.deferPreparation(current.id, stopped, { error: message(error), retryAt }, time);
      report(deferred, "preparation", "Worktree or agent preparation stopped; no additional agent attempt was consumed.", error, deferred.retryAt === null ? undefined : deferred.retryAt);
    }
  };
  const cleanup = async (repository: RepositoryWork, pr: PullRequestState, reservation: Reservation): Promise<void> => {
    try {
      const outcome = await git.cleanupWorktree(store, repository.local!, pr, { ...excluded, ...stopped }, reservation.controller.signal);
      cleanupRetryAt.delete(key(pr));
      log({ level: "info", phase: "cleanup", repository: repository.configuration.coordinate, number: pr.number,
        message: outcome.kind === "cleaned" ? "The closed PR's worktree was removed." : "The PR reopened; its worktree is retained for the next review." });
    } catch (error) {
      if (uncertainGit(error)) { blocked.add(key(pr)); safeToReleaseLock = false; }
      const retryAt = now() + configuration.retryDelayMs;
      cleanupRetryAt.set(key(pr), retryAt);
      log({ level: "error", phase: "cleanup", repository: repository.configuration.coordinate, number: pr.number,
        message: blocked.has(key(pr)) ? "Cleanup has an uncertain Git outcome and is blocked." : "Worktree cleanup failed and remains pending.", error, retryAt });
    }
  };
  const abort = (): void => { for (const reservation of reservations.values()) reservation.controller.abort(signal.reason); notify(); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (!signal.aborted) {
      const time = now();
      cancelIneligible();
      for (const repository of repositories) {
        if (signal.aborted) break;
        if (repository.polling || repository.blocked || repository.nextPollAt > time) continue;
        repository.polling = true;
        track(() => poll(repository), () => { repository.polling = false; });
      }
      for (const pr of store.listCleanupCandidates()) {
        if (signal.aborted) break;
        const prKey = key(pr);
        const repository = localRepositories.get(repositoryKey(pr));
        if (repository === undefined || repository.blocked || reservations.has(prKey) || blocked.has(prKey) || (cleanupRetryAt.get(prKey) ?? 0) > time) continue;
        const reservation: Reservation = { kind: "cleanup", controller: new AbortController() };
        reservations.set(prKey, reservation);
        track(() => cleanup(repository, pr, reservation), () => { reservations.delete(prKey); });
      }
      const eligible = new Set<string>();
      for (const candidate of store.listCandidates(time)) {
        const pr = candidate.pullRequest;
        const prKey = key(pr);
        const repository = localRepositories.get(repositoryKey(pr));
        if (repository === undefined || repository.blocked || reservations.has(prKey) || blocked.has(prKey)) continue;
        eligible.add(prKey);
        // Updating a waiting target keeps its queue position; successors rejoin after admission.
        waiting.set(prKey, candidate);
      }
      for (const prKey of waiting.keys()) if (!eligible.has(prKey)) {
        waiting.delete(prKey);
        checkAdmissions.delete(prKey);
      }
      for (const [prKey, candidate] of waiting) {
        if (signal.aborted || workers >= configuration.maxConcurrentWorker) break;
        const pr = candidate.pullRequest;
        const repository = localRepositories.get(repositoryKey(pr))!;
        let admission = checkAdmissions.get(prKey);
        if (admission === undefined || admission.target !== target(pr)) {
          admission = { target: target(pr), checking: false, ready: false, nextCheckAt: 0, reported: false };
          checkAdmissions.set(prKey, admission);
        }
        if (!admission.checking && admission.nextCheckAt <= time) {
          const checking = admission;
          checking.checking = true;
          checking.ready = false;
          track(() => checkCandidate(repository, pr, checking), () => { checking.checking = false; });
        }
        if (admission.checking || !admission.ready) continue;
        waiting.delete(prKey);
        checkAdmissions.delete(prKey);
        const review = store.reserveReview(pr, { reviewId: randomUUID(), sessionId: randomUUID(), maxAttempts: configuration.maxAttempts }, time);
        if (review === null) continue;
        const reservation: Reservation = { kind: "review", controller: new AbortController(), reviewId: review.id };
        reservations.set(prKey, reservation);
        workers++;
        report(review, "reserved", "Reserved this PR across worktree preparation and agent execution.");
        track(() => reviewPullRequest(repository, review, reservation), () => { reservations.delete(prKey); workers--; });
      }
      const deadlines = repositories.filter((repository) => !repository.polling && !repository.blocked).map((repository) => repository.nextPollAt);
      if (workers < configuration.maxConcurrentWorker) for (const review of store.listActiveReviews()) {
        if (review.status === "retry_wait" && review.retryAt !== null && review.retryAt > now() && !blocked.has(key(review))) deadlines.push(review.retryAt);
      }
      if (workers < configuration.maxConcurrentWorker) for (const admission of checkAdmissions.values()) {
        if (!admission.checking) deadlines.push(admission.nextCheckAt);
      }
      for (const [prKey, deadline] of cleanupRetryAt) if (!blocked.has(prKey) && deadline > now()) deadlines.push(deadline);
      const delay = deadlines.length === 0 ? 2_147_483_647 : Math.min(2_147_483_647, Math.max(0, Math.min(...deadlines) - now()));
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => { wake = undefined; resolve(); }, delay);
        wake = () => { clearTimeout(timer); wake = undefined; resolve(); };
        if (signal.aborted) wake();
      });
      // Completed polls can wake only microtasks when their next deadline is already due.
      await setImmediate();
    }
  } finally {
    lifetime.abort(new Error("The coordinator is stopping."));
    abort();
    signal.removeEventListener("abort", abort);
    await Promise.all(pending);
  }
  return { safeToReleaseLock };
};
