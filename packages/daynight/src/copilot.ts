import path from "node:path";
import { lstat, mkdir, mkdtemp, open } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ChildProcess } from "node:child_process";
import crossSpawn from "cross-spawn";
import { remoteIdentity } from "./config.js";
import { isolatedGitEnvironment } from "./git.js";
import type { PreparedWorktree } from "./git.js";
import type { RuntimePaths } from "./paths.js";
import type { AttemptIdentity, ReviewState, Store } from "./store.js";

export type PreviousReview = Pick<ReviewState, "id" | "revision" | "headSha" | "baseRef">;
export type CopilotAttemptOutcome = {
  attempt: AttemptIdentity;
  sessionId: string;
  sessionMode: "create" | "resume";
  stdoutLogPath: string;
  stderrLogPath: string;
  completed: boolean;
  directProcessClosed: boolean;
  captureComplete: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  lastNonemptyLine: string | null;
  interruption: "aborted" | "timeout" | null;
  errors: Error[];
};
export type CopilotRunnerOptions = {
  paths: RuntimePaths;
  processOwner: string;
  timeoutMs: number;
  terminationGraceMs?: number;
  maxLineCharacters?: number;
  now?: () => number;
  environment?: NodeJS.ProcessEnv;
  command?: { file: string; args?: readonly string[] };
};
export type CopilotRunOptions = {
  signal?: AbortSignal;
  previousReview?: PreviousReview;
  onProcess?: (child: ChildProcess, attempt: AttemptIdentity) => void;
};

const asError = (value: unknown): Error => value instanceof Error ? value : new Error(String(value));
const positiveInteger = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) throw new Error(`${name} must be a positive integer no greater than 2147483647.`);
};
const sessionExists = async (directory: string): Promise<boolean> => {
  try {
    if (!(await lstat(directory)).isDirectory()) throw new Error(`Copilot session history ${directory} must be a directory.`);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
};

const reviewPrompt = (review: ReviewState, worktree: PreparedWorktree, repository: { owner: string; name: string }, previous?: PreviousReview): string => `You are the Copilot code review agent for daynight.
Review this immutable target:
${JSON.stringify({ host: review.host, repositoryId: review.githubId, repository: `${repository.owner}/${repository.name}`, pullRequest: review.number,
  reviewId: review.id, revision: review.revision, headSha: review.headSha, baseBranch: review.baseRef, baseSha: worktree.baseSha, mergeBaseSha: worktree.mergeBaseSha })}
The worktree is already prepared. Review the changes from merge-base to head and trace affected callers and contracts. Its Git environment exposes the original commit objects and a complete checkout.
${previous === undefined ? "" : `A previous unfinished review may have published results: ${JSON.stringify(previous)}. Reconcile its existing effects; do not publish a review for its obsolete target merely to confirm it.\n`}This attempt may follow an interrupted or incomplete attempt of this same review. First inspect the PR's existing reviews and inline comments for the stable identity below. If this target's required result was already published successfully, confirm it without publishing it again; otherwise finish the remaining work.
Stable review identity: daynight review=${review.id} revision=${review.revision} head=${review.headSha}
Publish the review yourself using gh api. Immediately before publication re-read the PR and require it to be Open, non-Draft, with head SHA ${review.headSha} and base branch ${JSON.stringify(review.baseRef)}. If it is stale, closed, Draft, inaccessible, or publication fails, explain the problem and do not output the completion marker.
Use POST repos/${repository.owner}/${repository.name}/pulls/${review.number}/reviews on host ${review.host}. Explicitly set commit_id to ${review.headSha} and include the stable review identity in the review body. Use English and identify yourself as Copilot in published text.
Report only actionable Critical or Major problems introduced by this change, using inline comments on the relevant changed lines in a COMMENT review. Never submit REQUEST_CHANGES. If no Critical or Major problem remains, publish APPROVE. Verify the required publication succeeded. Do not treat an existing COMMENT as evidence of approval, and do not claim success when you cannot approve your own PR.
The repository and worktree are dedicated to this review system. Worktree creation, reset and cleanup belong to daynight; do not perform those lifecycle operations. Keep supplementary clones and temporary resources under the supplied temporary directory.
After the required review result has been published or confirmed, finish stdout with exactly this standalone line, with no text after it:
PR ${review.number} Review Completed
`;

class LastLine extends Transform {
  readonly decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  readonly limit: number;
  line = "";
  overflow = false;
  lastNonempty: string | null = null;
  constructor(limit: number) { super(); this.limit = limit; }
  accept(text: string): void {
    for (const piece of text.split(/(?<=\n)/)) {
      const newline = piece.endsWith("\n");
      const content = newline ? piece.slice(0, -1) : piece;
      if (this.line.length + content.length > this.limit) this.overflow = true;
      if (!this.overflow) this.line += content;
      if (newline) {
        const value = this.line.endsWith("\r") ? this.line.slice(0, -1) : this.line;
        if (this.overflow || value.length !== 0) this.lastNonempty = this.overflow ? null : value;
        this.line = ""; this.overflow = false;
      }
    }
  }
  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: Buffer) => void): void {
    try { this.accept(this.decoder.decode(chunk, { stream: true })); callback(null, chunk); } catch (error) { callback(asError(error)); }
  }
  override _flush(callback: (error?: Error | null) => void): void {
    try {
      this.accept(this.decoder.decode());
      if (this.overflow || this.line.length !== 0) this.lastNonempty = this.overflow ? null : this.line;
      callback();
    } catch (error) { callback(asError(error)); }
  }
}

/** Runs one persisted attempt; the caller retains scheduling, final state transitions, and descendant-process exclusion. */
export const createCopilotRunner = (options: CopilotRunnerOptions) => {
  const now = options.now === undefined ? Date.now : options.now;
  const grace = options.terminationGraceMs === undefined ? 5_000 : options.terminationGraceMs;
  const lineLimit = options.maxLineCharacters === undefined ? 8_192 : options.maxLineCharacters;
  positiveInteger(options.timeoutMs, "Copilot timeout"); positiveInteger(grace, "Termination grace"); positiveInteger(lineLimit, "Line character limit");
  if (options.processOwner.trim() === "") throw new Error("Copilot process owner must be nonempty.");

  const run = async (store: Store, reviewId: string, worktree: PreparedWorktree, input: CopilotRunOptions = {}): Promise<CopilotAttemptOutcome> => {
    input.signal?.throwIfAborted();
    const review = store.getReview(reviewId);
    if (review === null) throw new Error("The Copilot review does not exist.");
    const pr = store.getPullRequest(review);
    const repository = store.getRepository(review);
    if (pr === null || repository === null || pr.sessionId === null || pr.worktreePath !== worktree.path || review.headSha !== worktree.headSha || review.baseSha !== worktree.baseSha) throw new Error("The prepared Copilot target does not match persisted review state.");
    const coordinate = remoteIdentity(repository.remote, "Review repository remote");
    const sessionDirectory = path.join(options.paths.copilotDirectory, "session-state", pr.sessionId);
    const existing = await sessionExists(sessionDirectory);
    if (pr.sessionEstablished && !existing) throw new Error(`Established Copilot session ${pr.sessionId} is missing its history at ${sessionDirectory}.`);
    if (existing && !pr.sessionEstablished) store.markSessionEstablished(pr);
    const mode = existing ? "resume" : "create";
    const reviewLogs = path.join(options.paths.logsDirectory, review.id);
    await Promise.all([options.paths.copilotDirectory, options.paths.cacheDirectory, options.paths.temporaryDirectory, reviewLogs].map((directory) => mkdir(directory, { recursive: true })));
    const attemptDirectory = await mkdtemp(path.join(reviewLogs, `${review.attemptCount + 1}-`));
    const stdoutLogPath = path.join(attemptDirectory, "stdout.log");
    const stderrLogPath = path.join(attemptDirectory, "stderr.log");
    const stdoutFile = await open(stdoutLogPath, "wx", 0o600);
    let stderrFile;
    try { stderrFile = await open(stderrLogPath, "wx", 0o600); } catch (error) { await stdoutFile.close(); throw error; }
    let launched: ReviewState;
    try {
      input.signal?.throwIfAborted();
      launched = store.startAttempt(review.id, { processOwner: options.processOwner, stdoutLogPath, stderrLogPath }, now());
    } catch (error) { await Promise.all([stdoutFile.close(), stderrFile.close()]); throw error; }
    const attempt = { reviewId: review.id, attempt: launched.attemptCount };
    const errors: Error[] = [];
    const outcome: CopilotAttemptOutcome = { attempt, sessionId: pr.sessionId, sessionMode: mode, stdoutLogPath, stderrLogPath,
      completed: false, directProcessClosed: false, captureComplete: false, exitCode: null, signal: null, lastNonemptyLine: null, interruption: null, errors };
    const parentEnvironment = options.environment === undefined ? process.env : options.environment;
    const environment: NodeJS.ProcessEnv = { ...parentEnvironment, ...isolatedGitEnvironment(parentEnvironment, worktree.gitEnvironment),
      COPILOT_HOME: options.paths.copilotDirectory, COPILOT_CACHE_HOME: options.paths.cacheDirectory,
      TMPDIR: options.paths.temporaryDirectory, TMP: options.paths.temporaryDirectory, TEMP: options.paths.temporaryDirectory,
      NO_COLOR: "1", GH_PROMPT_DISABLED: "1", GH_FORCE_TTY: "", PAGER: "cat", GH_PAGER: "cat" };
    delete environment.GH_DEBUG;
    const args = [...(options.command?.args === undefined ? [] : options.command.args), "-C", worktree.path,
      `--${mode === "resume" ? "resume" : "session-id"}=${pr.sessionId}`, "-s", "--output-format", "text", "--stream", "on", "--no-color",
      "--no-ask-user", "--no-auto-update", "--allow-all-tools", "--log-dir", attemptDirectory];
    let child;
    try { child = crossSpawn(options.command === undefined ? "copilot" : options.command.file, args, { cwd: worktree.path, env: environment, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }); }
    catch (error) { errors.push(asError(error)); await Promise.all([stdoutFile.close(), stderrFile.close()]); outcome.directProcessClosed = true; return outcome; }
    const parser = new LastLine(lineLimit);
    let timeout: NodeJS.Timeout | undefined;
    let force: NodeJS.Timeout | undefined;
    let abandon: NodeJS.Timeout | undefined;
    let stopped = false;
    let resolveClose: () => void;
    const closed = new Promise<void>((resolve) => { resolveClose = resolve; });
    const stop = (): void => {
      if (stopped || outcome.directProcessClosed) return;
      stopped = true;
      child.kill("SIGTERM");
      force = setTimeout(() => {
        child.kill("SIGKILL");
        abandon = setTimeout(() => {
          errors.push(new Error("Copilot did not close its process and streams within the termination grace period; descendant processes must be excluded before reuse."));
          child.stdin!.destroy(); child.stdout!.destroy(); child.stderr!.destroy(); resolveClose();
        }, grace);
      }, grace);
    };
    child.once("error", (error) => { errors.push(error); stop(); });
    child.once("spawn", () => {
      try {
        store.recordProcess(attempt, { pid: child.pid!, identity: `${options.processOwner}:${review.id}:${attempt.attempt}` });
        input.onProcess?.(child, attempt);
      } catch (error) { errors.push(asError(error)); stop(); }
    });
    child.once("close", (code, signal) => { outcome.directProcessClosed = true; outcome.exitCode = code; outcome.signal = signal; resolveClose(); });
    const abort = (): void => { outcome.interruption = "aborted"; stop(); };
    input.signal?.addEventListener("abort", abort, { once: true });
    timeout = setTimeout(() => { outcome.interruption = "timeout"; stop(); }, options.timeoutMs);
    const capture = async (operation: Promise<void>): Promise<boolean> => {
      try { await operation; return true; } catch (error) { errors.push(asError(error)); stop(); return false; }
    };
    const outputs = [capture(pipeline(child.stdout!, parser, stdoutFile.createWriteStream())), capture(pipeline(child.stderr!, stderrFile.createWriteStream())),
      capture(pipeline(Readable.from([reviewPrompt(launched, worktree, coordinate, input.previousReview)]), child.stdin!))];
    if (input.signal?.aborted) abort();
    await closed;
    if (timeout !== undefined) clearTimeout(timeout);
    if (force !== undefined) clearTimeout(force);
    if (abandon !== undefined) clearTimeout(abandon);
    input.signal?.removeEventListener("abort", abort);
    outcome.captureComplete = (await Promise.all(outputs)).every(Boolean);
    outcome.lastNonemptyLine = parser.lastNonempty;
    try {
      if (await sessionExists(sessionDirectory)) store.markSessionEstablished(pr);
      else errors.push(new Error(`Copilot session ${pr.sessionId} did not retain its history at ${sessionDirectory}.`));
    } catch (error) { errors.push(asError(error)); }
    outcome.completed = outcome.directProcessClosed && outcome.captureComplete && errors.length === 0 && outcome.interruption === null && outcome.exitCode === 0 && outcome.signal === null && outcome.lastNonemptyLine === `PR ${review.number} Review Completed`;
    return outcome;
  };
  return { run };
};
