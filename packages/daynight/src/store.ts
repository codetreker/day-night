import path from "node:path";
import { lstatSync, statSync } from "node:fs";
import Database from "better-sqlite3";

export type RepositoryIdentity = { host: string; githubId: string };
export type PullRequestIdentity = RepositoryIdentity & { number: number };
export type RepositoryState = RepositoryIdentity & {
  remote: string;
  localPath: string;
  startPrNumber: number | null;
  initializedAt: number | null;
  lastPollAt: number | null;
  lastPollError: string | null;
};
export type PullRequestObservation = {
  number: number;
  state: "open" | "closed" | "merged";
  draft: boolean;
  headSha: string;
  baseRef: string;
  baseSha: string;
};
export type RepositoryPollUpdate =
  | { kind: "initialize"; startPrNumber: number }
  | { kind: "snapshot"; observations: readonly PullRequestObservation[] };
export type PullRequestState = PullRequestIdentity & Omit<PullRequestObservation, "number"> & {
  desiredRevision: number;
  completedRevision: number;
  sessionId: string | null;
  sessionEstablished: boolean;
  worktreePath: string | null;
  cleanupPending: boolean;
  cleanupError: string | null;
  observedAt: number;
};
export type ReviewStatus = "preparing" | "running" | "retry_wait" | "completed" | "failed" | "interrupted" | "superseded";
export type ReviewState = PullRequestIdentity & {
  id: string;
  revision: number;
  headSha: string;
  baseRef: string;
  baseSha: string | null;
  status: ReviewStatus;
  attemptCount: number;
  maxAttempts: number;
  retryAt: number | null;
  processOwner: string | null;
  processId: number | null;
  processIdentity: string | null;
  stdoutLogPath: string | null;
  stderrLogPath: string | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
};
export type ReviewCandidate = { pullRequest: PullRequestState; review: ReviewState | null };
export type ReviewListingSnapshot = {
  repositories: RepositoryState[];
  pullRequests: PullRequestState[];
  reviews: ReviewState[];
};
export type AttemptIdentity = { reviewId: string; attempt: number };
export type OperationsStopped = { operationsStopped: true };
export type ProcessesExcluded = { processesExcluded: true };

type PullRequestRow = Omit<PullRequestState, "draft" | "sessionEstablished" | "cleanupPending"> & {
  draft: number; sessionEstablished: number; cleanupPending: number;
};

const repositoryColumns = `host, github_id AS githubId, remote, local_path AS localPath,
  start_pr_no AS startPrNumber, initialized_at AS initializedAt,
  last_poll_at AS lastPollAt, last_poll_error AS lastPollError`;
const pullRequestColumns = `host, github_id AS githubId, number, state, draft,
  head_sha AS headSha, base_ref AS baseRef, base_sha AS baseSha,
  desired_revision AS desiredRevision, completed_revision AS completedRevision,
  session_id AS sessionId, session_established AS sessionEstablished,
  worktree_path AS worktreePath, cleanup_pending AS cleanupPending, cleanup_error AS cleanupError, observed_at AS observedAt`;
const reviewColumns = `host, github_id AS githubId, number, id, revision,
  head_sha AS headSha, base_ref AS baseRef, base_sha AS baseSha, status,
  attempt_count AS attemptCount, max_attempts AS maxAttempts, retry_at AS retryAt,
  process_owner AS processOwner, process_id AS processId, process_identity AS processIdentity,
  stdout_log_path AS stdoutLogPath, stderr_log_path AS stderrLogPath, last_error AS lastError,
  created_at AS createdAt, updated_at AS updatedAt`;
const activeStatuses = "'preparing', 'running', 'retry_wait', 'interrupted'";

const requireText = (value: string, name: string): void => {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${name} must be a nonempty string.`);
};
const requireInteger = (value: number, name: string, minimum = 0): void => {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${name} must be a safe integer of at least ${minimum}.`);
};
const requireUuid = (value: string, name: string): void => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${name} must be a UUID.`);
  }
};
const repositoryKey = (identity: RepositoryIdentity): RepositoryIdentity => {
  requireText(identity.host, "Repository host");
  requireText(identity.githubId, "GitHub repository ID");
  return { host: identity.host.toLowerCase(), githubId: identity.githubId };
};
const pullRequestKey = (identity: PullRequestIdentity): PullRequestIdentity => {
  requireInteger(identity.number, "PR number", 1);
  return { ...repositoryKey(identity), number: identity.number };
};
const asPullRequest = (row: PullRequestRow): PullRequestState => ({
  ...row, draft: row.draft === 1, sessionEstablished: row.sessionEstablished === 1, cleanupPending: row.cleanupPending === 1,
});
const requireStopped = (proof: OperationsStopped): void => {
  if (proof.operationsStopped !== true) throw new Error("The caller must confirm that all PR operations have stopped.");
};
const requireExcluded = (proof: ProcessesExcluded): void => {
  if (proof.processesExcluded !== true) throw new Error("The caller must exclude any previous agent processes first.");
};

const schema = `
  CREATE TABLE repositories (
    host TEXT NOT NULL,
    github_id TEXT NOT NULL,
    remote TEXT NOT NULL,
    local_path TEXT NOT NULL,
    start_pr_no INTEGER CHECK(start_pr_no >= 0),
    initialized_at INTEGER,
    last_poll_at INTEGER,
    last_poll_error TEXT,
    PRIMARY KEY(host, github_id),
    CHECK((start_pr_no IS NULL) = (initialized_at IS NULL))
  ) STRICT;
  CREATE TABLE pull_requests (
    host TEXT NOT NULL,
    github_id TEXT NOT NULL,
    number INTEGER NOT NULL CHECK(number > 0),
    state TEXT NOT NULL CHECK(state IN ('open', 'closed', 'merged')),
    draft INTEGER NOT NULL CHECK(draft IN (0, 1)),
    head_sha TEXT NOT NULL,
    base_ref TEXT NOT NULL,
    base_sha TEXT NOT NULL,
    desired_revision INTEGER NOT NULL CHECK(desired_revision > 0),
    completed_revision INTEGER NOT NULL DEFAULT 0 CHECK(completed_revision >= 0 AND completed_revision <= desired_revision),
    session_id TEXT,
    session_established INTEGER NOT NULL DEFAULT 0 CHECK(session_established IN (0, 1)),
    worktree_path TEXT,
    cleanup_pending INTEGER NOT NULL DEFAULT 0 CHECK(cleanup_pending IN (0, 1)),
    cleanup_error TEXT,
    observed_at INTEGER NOT NULL,
    PRIMARY KEY(host, github_id, number),
    CHECK(session_established = 0 OR session_id IS NOT NULL),
    CHECK(cleanup_pending = 0 OR worktree_path IS NOT NULL)
  ) STRICT;
  CREATE TABLE reviews (
    id TEXT PRIMARY KEY,
    host TEXT NOT NULL,
    github_id TEXT NOT NULL,
    number INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK(revision > 0),
    head_sha TEXT NOT NULL,
    base_ref TEXT NOT NULL,
    base_sha TEXT,
    status TEXT NOT NULL CHECK(status IN ('preparing', 'running', 'retry_wait', 'completed', 'failed', 'interrupted', 'superseded')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
    max_attempts INTEGER NOT NULL CHECK(max_attempts > 0 AND attempt_count <= max_attempts),
    retry_at INTEGER,
    process_owner TEXT,
    process_id INTEGER,
    process_identity TEXT,
    stdout_log_path TEXT,
    stderr_log_path TEXT,
    last_error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    CHECK((status = 'retry_wait') = (retry_at IS NOT NULL)),
    CHECK(status <> 'running' OR (base_sha IS NOT NULL AND attempt_count > 0 AND process_owner IS NOT NULL AND stdout_log_path IS NOT NULL AND stderr_log_path IS NOT NULL)),
    CHECK((process_id IS NULL) = (process_identity IS NULL))
  ) STRICT;
  CREATE UNIQUE INDEX reviews_one_active_per_pr ON reviews(host, github_id, number)
    WHERE status IN (${activeStatuses});
  CREATE INDEX reviews_revision ON reviews(host, github_id, number, revision);
  PRAGMA user_version = 1;
`;

const reviewDatabaseIsMissing = (databaseFile: string): boolean => {
  // Windows may report ENOENT for a file ancestor; ordinary absence requires an existing directory.
  // https://github.com/nodejs/node/blob/955266bfdd854cd280dffd47548673914484e4c0/deps/uv/src/win/error.c#L134-L142
  let candidate = databaseFile;
  while (true) {
    let status;
    try {
      status = lstatSync(candidate);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      const parent = path.dirname(candidate);
      if (parent === candidate) throw error;
      candidate = parent;
      continue;
    }
    if (candidate === databaseFile) return false;
    const ancestor = status.isSymbolicLink() ? statSync(candidate) : status;
    if (!ancestor.isDirectory()) throw new Error(`The SQLite database path ancestor ${candidate} is not a directory.`);
    return true;
  }
};

export const readReviewListingSnapshot = (databaseFile: string): ReviewListingSnapshot | null => {
  if (!path.isAbsolute(databaseFile)) throw new Error("The SQLite database path must be absolute.");
  if (reviewDatabaseIsMissing(databaseFile)) return null;
  const db = new Database(databaseFile, { readonly: true, fileMustExist: true, timeout: 5000 });
  let operationFailed = false;
  let operationError: unknown;
  try {
    return db.transaction(() => {
      const version = db.pragma("user_version", { simple: true }) as number;
      if (version !== 1) throw new Error(`Review listing requires SQLite schema version 1; found version ${version}.`);
      const repositories = db.prepare(`SELECT ${repositoryColumns} FROM repositories ORDER BY host, github_id`).all() as RepositoryState[];
      const pullRequests = (db.prepare(`SELECT ${pullRequestColumns} FROM pull_requests WHERE state = 'open' ORDER BY host, github_id, number`)
        .all() as PullRequestRow[]).map(asPullRequest);
      const reviews = db.prepare(`SELECT ${reviewColumns} FROM reviews r
        WHERE EXISTS(SELECT 1 FROM pull_requests p WHERE p.host = r.host AND p.github_id = r.github_id AND p.number = r.number AND p.state = 'open'
          AND ((r.revision = p.desired_revision AND r.head_sha = p.head_sha AND r.base_ref = p.base_ref) OR r.status IN (${activeStatuses})))
        ORDER BY host, github_id, number, created_at, id`).all() as ReviewState[];
      return { repositories, pullRequests, reviews };
    }).deferred();
  } catch (error) {
    operationFailed = true;
    operationError = error;
    throw error;
  } finally {
    try { db.close(); } catch (closeError) {
      if (operationFailed) throw new AggregateError([operationError, closeError], "SQLite review listing and connection cleanup failed.");
      throw closeError;
    }
  }
};

export const openStore = (databaseFile: string, options: { busyTimeoutMs?: number } = {}) => {
  if (!path.isAbsolute(databaseFile)) throw new Error("The SQLite database path must be absolute.");
  const busyTimeoutMs = options.busyTimeoutMs === undefined ? 5000 : options.busyTimeoutMs;
  requireInteger(busyTimeoutMs, "SQLite busy timeout", 1);
  if (busyTimeoutMs > 60000) throw new Error("SQLite busy timeout must not exceed 60000 milliseconds.");
  const db = new Database(databaseFile, { timeout: busyTimeoutMs });
  try {
    const version = db.pragma("user_version", { simple: true }) as number;
    if (version > 1) throw new Error(`SQLite schema version ${version} is newer than supported version 1.`);
    if (version < 0) throw new Error(`Unsupported SQLite schema version ${version}.`);
    const journalMode = db.pragma("journal_mode = WAL", { simple: true });
    if (journalMode !== "wal") throw new Error(`SQLite refused WAL mode: ${String(journalMode)}.`);
    db.pragma("synchronous = FULL");
    if (db.pragma("synchronous", { simple: true }) !== 2) throw new Error("SQLite refused synchronous=FULL.");
    if (version === 0) db.transaction(() => db.exec(schema)).immediate();
  } catch (error) {
    try { db.close(); } catch (closeError) { throw new AggregateError([error, closeError], "SQLite startup and connection cleanup failed."); }
    throw error;
  }
  const atomic = <T>(operation: () => T): T => db.transaction(operation).immediate();
  const getRepository = (identity: RepositoryIdentity): RepositoryState | null => {
    const key = repositoryKey(identity);
    return db.prepare(`SELECT ${repositoryColumns} FROM repositories WHERE host = @host AND github_id = @githubId`).get(key) as RepositoryState | undefined ?? null;
  };
  const needRepository = (identity: RepositoryIdentity): RepositoryState => {
    const repository = getRepository(identity);
    if (repository === null) throw new Error("Repository is not registered.");
    return repository;
  };
  const getPullRequest = (identity: PullRequestIdentity): PullRequestState | null => {
    const row = db.prepare(`SELECT ${pullRequestColumns} FROM pull_requests WHERE host = @host AND github_id = @githubId AND number = @number`).get(pullRequestKey(identity)) as PullRequestRow | undefined;
    return row === undefined ? null : asPullRequest(row);
  };
  const needPullRequest = (identity: PullRequestIdentity): PullRequestState => {
    const pullRequest = getPullRequest(identity);
    if (pullRequest === null) throw new Error("PR is not tracked.");
    return pullRequest;
  };
  const getReview = (reviewId: string): ReviewState | null => {
    return db.prepare(`SELECT ${reviewColumns} FROM reviews WHERE id = ?`).get(reviewId) as ReviewState | undefined ?? null;
  };
  const needReview = (reviewId: string): ReviewState => {
    const review = getReview(reviewId);
    if (review === null) throw new Error("Review does not exist.");
    return review;
  };
  const activeReview = (identity: PullRequestIdentity): ReviewState | null => {
    return db.prepare(`SELECT ${reviewColumns} FROM reviews WHERE host = @host AND github_id = @githubId AND number = @number AND status IN (${activeStatuses})`).get(pullRequestKey(identity)) as ReviewState | undefined ?? null;
  };
  const isCurrentTarget = (review: ReviewState, pullRequest: PullRequestState): boolean =>
    pullRequest.state === "open" && !pullRequest.draft && !pullRequest.cleanupPending &&
    review.revision === pullRequest.desiredRevision && review.headSha === pullRequest.headSha && review.baseRef === pullRequest.baseRef;
  const attemptReview = (identity: AttemptIdentity): ReviewState => {
    const review = needReview(identity.reviewId);
    if (review.status !== "running" || review.attemptCount !== identity.attempt) throw new Error("The review attempt is not the current running attempt.");
    return review;
  };
  const setStatus = (review: ReviewState, status: ReviewStatus, now: number, error: string | null, retryAt: number | null = null): ReviewState => {
    db.prepare("UPDATE reviews SET status = @status, retry_at = @retryAt, last_error = @error, updated_at = @now WHERE id = @id")
      .run({ id: review.id, status, retryAt, error, now });
    return needReview(review.id);
  };

  const store = {
    close: (): void => { db.close(); },
    getRepository,
    getPullRequest,
    getReview,
    listRepositories: (): RepositoryState[] => db.prepare(`SELECT ${repositoryColumns} FROM repositories ORDER BY host, github_id`).all() as RepositoryState[],
    listPullRequests: (identity: RepositoryIdentity): PullRequestState[] =>
      (db.prepare(`SELECT ${pullRequestColumns} FROM pull_requests WHERE host = @host AND github_id = @githubId ORDER BY number`).all(repositoryKey(identity)) as PullRequestRow[]).map(asPullRequest),
    listActiveReviews: (): ReviewState[] =>
      db.prepare(`SELECT ${reviewColumns} FROM reviews WHERE status IN (${activeStatuses}) ORDER BY created_at, id`).all() as ReviewState[],
    listCleanupCandidates: (): PullRequestState[] =>
      (db.prepare(`SELECT ${pullRequestColumns} FROM pull_requests p WHERE cleanup_pending = 1
        AND NOT EXISTS(SELECT 1 FROM reviews r WHERE r.host = p.host AND r.github_id = p.github_id AND r.number = p.number AND r.status IN (${activeStatuses}))
        ORDER BY observed_at, host, github_id, number`).all() as PullRequestRow[]).map(asPullRequest),
    listReviews: (identity: PullRequestIdentity): ReviewState[] =>
      db.prepare(`SELECT ${reviewColumns} FROM reviews WHERE host = @host AND github_id = @githubId AND number = @number ORDER BY created_at, id`).all(pullRequestKey(identity)) as ReviewState[],
    registerRepository: (input: RepositoryIdentity & { remote: string; localPath: string }): RepositoryState => atomic(() => {
      const key = repositoryKey(input);
      requireText(input.remote, "Repository remote");
      requireText(input.localPath, "Repository local path");
      const existing = getRepository(key);
      if (existing !== null && existing.localPath !== input.localPath) {
        const worktree = db.prepare("SELECT 1 FROM pull_requests WHERE host = @host AND github_id = @githubId AND worktree_path IS NOT NULL LIMIT 1").get(key);
        if (worktree !== undefined) throw new Error("A repository with registered worktrees cannot change its local path.");
      }
      db.prepare(`INSERT INTO repositories(host, github_id, remote, local_path) VALUES(@host, @githubId, @remote, @localPath)
        ON CONFLICT(host, github_id) DO UPDATE SET remote = excluded.remote, local_path = excluded.local_path`).run({ ...key, remote: input.remote, localPath: input.localPath });
      return needRepository(key);
    }),
    initializeRepository: (identity: RepositoryIdentity, startPrNumber: number, now: number): RepositoryState => atomic(() => {
      const key = repositoryKey(identity);
      requireInteger(startPrNumber, "Start PR number");
      requireInteger(now, "Initialization time");
      needRepository(key);
      db.prepare("UPDATE repositories SET start_pr_no = @startPrNumber, initialized_at = @now WHERE host = @host AND github_id = @githubId AND start_pr_no IS NULL")
        .run({ ...key, startPrNumber, now });
      return needRepository(key);
    }),
    recordPollSuccess: (identity: RepositoryIdentity, now: number): RepositoryState => atomic(() => {
      const key = repositoryKey(identity);
      requireInteger(now, "Poll time");
      needRepository(key);
      db.prepare("UPDATE repositories SET last_poll_at = @now, last_poll_error = NULL WHERE host = @host AND github_id = @githubId").run({ ...key, now });
      return needRepository(key);
    }),
    recordPollError: (identity: RepositoryIdentity, error: string): RepositoryState => atomic(() => {
      const key = repositoryKey(identity);
      requireText(error, "Poll error");
      needRepository(key);
      db.prepare("UPDATE repositories SET last_poll_error = @error WHERE host = @host AND github_id = @githubId").run({ ...key, error });
      return needRepository(key);
    }),
    observePullRequest: (identity: RepositoryIdentity, observation: PullRequestObservation, now: number): PullRequestState | null => atomic(() => {
      const key = pullRequestKey({ ...identity, number: observation.number });
      requireInteger(now, "Observation time");
      if (!["open", "closed", "merged"].includes(observation.state) || typeof observation.draft !== "boolean") throw new Error("Invalid PR state or Draft flag.");
      requireText(observation.headSha, "PR head SHA");
      requireText(observation.baseRef, "PR base branch");
      requireText(observation.baseSha, "PR base SHA");
      const repository = needRepository(key);
      if (repository.startPrNumber === null) throw new Error("Repository initialization has not completed.");
      if (observation.number <= repository.startPrNumber) return null;
      const previous = getPullRequest(key);
      const triggered = previous === null || previous.headSha !== observation.headSha || previous.baseRef !== observation.baseRef ||
        (previous.draft && !observation.draft) || (previous.state !== "open" && observation.state === "open");
      const desiredRevision = previous === null ? 1 : previous.desiredRevision + Number(triggered);
      requireInteger(desiredRevision, "Desired revision", 1);
      // Observations cannot prove that an earlier cleanup operation has stopped.
      const cleanupPending = previous !== null && (previous.cleanupPending || (observation.state !== "open" && previous.worktreePath !== null));
      const parameters = { ...key, state: observation.state, draft: Number(observation.draft), headSha: observation.headSha,
        baseRef: observation.baseRef, baseSha: observation.baseSha, desiredRevision, cleanupPending: Number(cleanupPending),
        cleanupError: previous === null ? null : previous.cleanupError, now };
      if (previous === null) {
        db.prepare(`INSERT INTO pull_requests(host, github_id, number, state, draft, head_sha, base_ref, base_sha, desired_revision, cleanup_pending, observed_at)
          VALUES(@host, @githubId, @number, @state, @draft, @headSha, @baseRef, @baseSha, @desiredRevision, @cleanupPending, @now)`).run(parameters);
      } else {
        db.prepare(`UPDATE pull_requests SET state = @state, draft = @draft, head_sha = @headSha, base_ref = @baseRef, base_sha = @baseSha,
          desired_revision = @desiredRevision, cleanup_pending = @cleanupPending, cleanup_error = @cleanupError, observed_at = @now
          WHERE host = @host AND github_id = @githubId AND number = @number`).run(parameters);
      }
      return needPullRequest(key);
    }),
    listCandidates: (now: number): ReviewCandidate[] => {
      requireInteger(now, "Selection time");
      const rows = db.prepare(`SELECT ${pullRequestColumns} FROM pull_requests p WHERE state = 'open' AND draft = 0 AND cleanup_pending = 0
        AND desired_revision > completed_revision
        AND NOT EXISTS(SELECT 1 FROM reviews r WHERE r.host = p.host AND r.github_id = p.github_id AND r.number = p.number AND r.revision = p.desired_revision AND r.status = 'failed')
        AND NOT EXISTS(SELECT 1 FROM reviews r WHERE r.host = p.host AND r.github_id = p.github_id AND r.number = p.number AND r.status IN ('preparing', 'running', 'interrupted'))
        AND NOT EXISTS(SELECT 1 FROM reviews r WHERE r.host = p.host AND r.github_id = p.github_id AND r.number = p.number AND r.status = 'retry_wait' AND r.revision = p.desired_revision AND r.retry_at > @now)
        ORDER BY observed_at, host, github_id, number`).all({ now }) as PullRequestRow[];
      return rows.map((row) => { const pullRequest = asPullRequest(row); return { pullRequest, review: activeReview(pullRequest) }; });
    },
    reserveReview: (identity: PullRequestIdentity, input: { reviewId: string; sessionId: string; maxAttempts: number }, now: number): ReviewState | null => atomic(() => {
      const pullRequest = needPullRequest(identity);
      requireInteger(now, "Reservation time");
      requireInteger(input.maxAttempts, "Maximum attempts", 1);
      requireUuid(input.reviewId, "Review ID");
      requireUuid(input.sessionId, "Session ID");
      if (pullRequest.state !== "open" || pullRequest.draft || pullRequest.cleanupPending || pullRequest.desiredRevision <= pullRequest.completedRevision) return null;
      let active = activeReview(pullRequest);
      if (active !== null && active.status === "retry_wait" && !isCurrentTarget(active, pullRequest)) {
        setStatus(active, "superseded", now, active.lastError);
        active = null;
      }
      if (active !== null) {
        if (active.status !== "retry_wait" || active.retryAt === null || active.retryAt > now) return null;
        if (active.attemptCount >= active.maxAttempts) { setStatus(active, "failed", now, active.lastError); return null; }
        return setStatus(active, "preparing", now, active.lastError);
      }
      const failed = db.prepare("SELECT 1 FROM reviews WHERE host = @host AND github_id = @githubId AND number = @number AND revision = @revision AND status = 'failed' LIMIT 1")
        .get({ ...pullRequestKey(pullRequest), revision: pullRequest.desiredRevision });
      if (failed !== undefined) return null;
      if (pullRequest.sessionId === null) {
        db.prepare("UPDATE pull_requests SET session_id = @sessionId WHERE host = @host AND github_id = @githubId AND number = @number")
          .run({ ...pullRequestKey(pullRequest), sessionId: input.sessionId });
      }
      db.prepare(`INSERT INTO reviews(id, host, github_id, number, revision, head_sha, base_ref, status, max_attempts, created_at, updated_at)
        VALUES(@id, @host, @githubId, @number, @revision, @headSha, @baseRef, 'preparing', @maxAttempts, @now, @now)`)
        .run({ ...pullRequestKey(pullRequest), id: input.reviewId, revision: pullRequest.desiredRevision, headSha: pullRequest.headSha,
          baseRef: pullRequest.baseRef, maxAttempts: input.maxAttempts, now });
      return needReview(input.reviewId);
    }),
    pinReviewBase: (reviewId: string, baseSha: string, now: number): ReviewState => atomic(() => {
      requireText(baseSha, "Pinned base SHA");
      requireInteger(now, "Pin time");
      const review = needReview(reviewId);
      if (review.status !== "preparing") throw new Error("Only a preparing review may pin its base SHA.");
      if (review.baseSha !== null && review.baseSha !== baseSha) throw new Error("A review's pinned base SHA is immutable.");
      db.prepare("UPDATE reviews SET base_sha = @baseSha, updated_at = @now WHERE id = @id").run({ id: reviewId, baseSha, now });
      return needReview(reviewId);
    }),
    startAttempt: (reviewId: string, input: { processOwner: string; stdoutLogPath: string; stderrLogPath: string }, now: number): ReviewState => atomic(() => {
      requireInteger(now, "Launch time");
      requireText(input.processOwner, "Process owner");
      requireText(input.stdoutLogPath, "Stdout log path");
      requireText(input.stderrLogPath, "Stderr log path");
      const review = needReview(reviewId);
      const pullRequest = needPullRequest(review);
      if (review.status !== "preparing" || !isCurrentTarget(review, pullRequest)) throw new Error("The captured review target is no longer ready to run.");
      if (review.baseSha === null || pullRequest.worktreePath === null || pullRequest.sessionId === null) throw new Error("The review's base, worktree, and session must be persisted before launch.");
      if (review.attemptCount >= review.maxAttempts) throw new Error("The review attempt budget is exhausted.");
      // Launch intent consumes the budget before spawn; a crash in that gap cannot grant another attempt.
      db.prepare(`UPDATE reviews SET status = 'running', attempt_count = attempt_count + 1, retry_at = NULL,
        process_owner = @processOwner, process_id = NULL, process_identity = NULL, stdout_log_path = @stdoutLogPath,
        stderr_log_path = @stderrLogPath, updated_at = @now WHERE id = @id`).run({ id: reviewId, ...input, now });
      return needReview(reviewId);
    }),
    recordProcess: (identity: AttemptIdentity, input: { pid: number; identity: string }): ReviewState => atomic(() => {
      requireInteger(input.pid, "Process ID", 1);
      requireText(input.identity, "Process identity");
      const review = attemptReview(identity);
      if (review.processId !== null && (review.processId !== input.pid || review.processIdentity !== input.identity)) throw new Error("The running attempt already has a different process identity.");
      db.prepare("UPDATE reviews SET process_id = @pid, process_identity = @identity WHERE id = @id").run({ id: review.id, ...input });
      return needReview(review.id);
    }),
    markSessionEstablished: (identity: PullRequestIdentity): PullRequestState => atomic(() => {
      const pullRequest = needPullRequest(identity);
      if (pullRequest.sessionId === null) throw new Error("The PR has no persisted session ID.");
      db.prepare("UPDATE pull_requests SET session_established = 1 WHERE host = @host AND github_id = @githubId AND number = @number").run(pullRequestKey(pullRequest));
      return needPullRequest(pullRequest);
    }),
    completeReview: (identity: AttemptIdentity, proof: ProcessesExcluded, now: number): ReviewState => atomic(() => {
      requireExcluded(proof);
      requireInteger(now, "Completion time");
      const review = attemptReview(identity);
      const completed = setStatus(review, "completed", now, null);
      db.prepare("UPDATE pull_requests SET completed_revision = MAX(completed_revision, @revision) WHERE host = @host AND github_id = @githubId AND number = @number")
        .run({ ...pullRequestKey(review), revision: review.revision });
      return completed;
    }),
    retryReview: (identity: AttemptIdentity, proof: ProcessesExcluded, input: { error: string; retryAt: number }, now: number): ReviewState => atomic(() => {
      requireExcluded(proof);
      requireInteger(now, "Attempt end time");
      requireInteger(input.retryAt, "Retry time");
      if (input.retryAt < now) throw new Error("Retry time cannot precede the attempt end time.");
      requireText(input.error, "Attempt error");
      const review = attemptReview(identity);
      if (!isCurrentTarget(review, needPullRequest(review))) return setStatus(review, "superseded", now, input.error);
      if (review.attemptCount >= review.maxAttempts) return setStatus(review, "failed", now, input.error);
      return setStatus(review, "retry_wait", now, input.error, input.retryAt);
    }),
    deferPreparation: (reviewId: string, proof: OperationsStopped, input: { error: string; retryAt: number }, now: number): ReviewState => atomic(() => {
      requireStopped(proof);
      requireInteger(now, "Preparation end time");
      requireInteger(input.retryAt, "Retry time");
      if (input.retryAt < now) throw new Error("Retry time cannot precede preparation end time.");
      requireText(input.error, "Preparation error");
      const review = needReview(reviewId);
      if (review.status !== "preparing") throw new Error("Only preparation can be deferred without consuming an agent attempt.");
      if (!isCurrentTarget(review, needPullRequest(review))) return setStatus(review, "superseded", now, input.error);
      return setStatus(review, "retry_wait", now, input.error, input.retryAt);
    }),
    markInterrupted: (reviewId: string, error: string, now: number): ReviewState => atomic(() => {
      requireInteger(now, "Interruption time");
      requireText(error, "Interruption error");
      const review = needReview(reviewId);
      if (review.status !== "preparing" && review.status !== "running" && review.status !== "interrupted") throw new Error("Only unresolved preparation or execution can be interrupted.");
      return setStatus(review, "interrupted", now, error);
    }),
    resolveInterrupted: (reviewId: string, proof: ProcessesExcluded & OperationsStopped, retryAt: number, now: number): ReviewState => atomic(() => {
      requireExcluded(proof);
      requireStopped(proof);
      requireInteger(now, "Recovery time");
      requireInteger(retryAt, "Retry time");
      if (retryAt < now) throw new Error("Retry time cannot precede recovery time.");
      const review = needReview(reviewId);
      if (review.status !== "interrupted") throw new Error("Review is not interrupted.");
      if (!isCurrentTarget(review, needPullRequest(review))) return setStatus(review, "superseded", now, review.lastError);
      if (review.attemptCount >= review.maxAttempts) return setStatus(review, "failed", now, review.lastError);
      return setStatus(review, "retry_wait", now, review.lastError, retryAt);
    }),
    supersedeReview: (reviewId: string, proof: OperationsStopped, now: number): ReviewState => atomic(() => {
      requireStopped(proof);
      requireInteger(now, "Supersession time");
      const review = needReview(reviewId);
      if (review.status !== "preparing" && review.status !== "retry_wait") throw new Error("Running or interrupted execution cannot be superseded before it is resolved.");
      if (isCurrentTarget(review, needPullRequest(review))) throw new Error("A current review target cannot be superseded.");
      return setStatus(review, "superseded", now, review.lastError);
    }),
    registerWorktree: (identity: PullRequestIdentity, worktreePath: string): PullRequestState => atomic(() => {
      requireText(worktreePath, "Worktree path");
      const pullRequest = needPullRequest(identity);
      if (pullRequest.state !== "open" || pullRequest.cleanupPending) throw new Error("Cannot register a worktree for a closed PR.");
      if (pullRequest.worktreePath !== null && pullRequest.worktreePath !== worktreePath) throw new Error("The PR already owns a different worktree.");
      const active = activeReview(pullRequest);
      if (active !== null && (active.status === "running" || active.status === "interrupted")) throw new Error("Cannot change worktree registration while execution is unresolved.");
      db.prepare("UPDATE pull_requests SET worktree_path = @worktreePath WHERE host = @host AND github_id = @githubId AND number = @number")
        .run({ ...pullRequestKey(pullRequest), worktreePath });
      return needPullRequest(pullRequest);
    }),
    recordCleanupError: (identity: PullRequestIdentity, worktreePath: string, error: string): PullRequestState => atomic(() => {
      requireText(error, "Cleanup error");
      const pullRequest = needPullRequest(identity);
      if (!pullRequest.cleanupPending || pullRequest.worktreePath !== worktreePath) throw new Error("The pending worktree does not match cleanup.");
      db.prepare("UPDATE pull_requests SET cleanup_error = @error WHERE host = @host AND github_id = @githubId AND number = @number")
        .run({ ...pullRequestKey(pullRequest), error });
      return needPullRequest(pullRequest);
    }),
    cancelCleanup: (identity: PullRequestIdentity, worktreePath: string, proof: OperationsStopped & ProcessesExcluded): PullRequestState => atomic(() => {
      requireStopped(proof);
      requireExcluded(proof);
      const pullRequest = needPullRequest(identity);
      if (pullRequest.state !== "open") throw new Error("Only a reopened PR can cancel pending worktree cleanup.");
      if (!pullRequest.cleanupPending || pullRequest.worktreePath !== worktreePath) throw new Error("The pending worktree does not match cleanup.");
      if (activeReview(pullRequest) !== null) throw new Error("An active review blocks worktree cleanup cancellation.");
      db.prepare("UPDATE pull_requests SET cleanup_pending = 0, cleanup_error = NULL WHERE host = @host AND github_id = @githubId AND number = @number").run(pullRequestKey(pullRequest));
      return needPullRequest(pullRequest);
    }),
    completeCleanup: (identity: PullRequestIdentity, worktreePath: string, proof: OperationsStopped & ProcessesExcluded): PullRequestState => atomic(() => {
      requireStopped(proof);
      requireExcluded(proof);
      const pullRequest = needPullRequest(identity);
      if (pullRequest.state === "open") throw new Error("A reopened PR must retain its worktree.");
      if (!pullRequest.cleanupPending || pullRequest.worktreePath !== worktreePath) throw new Error("The pending worktree does not match cleanup.");
      if (activeReview(pullRequest) !== null) throw new Error("An active review blocks worktree cleanup.");
      db.prepare("UPDATE pull_requests SET worktree_path = NULL, cleanup_pending = 0, cleanup_error = NULL WHERE host = @host AND github_id = @githubId AND number = @number").run(pullRequestKey(pullRequest));
      return needPullRequest(pullRequest);
    }),
  };
  const applyRepositoryPoll = (
    identity: RepositoryIdentity,
    update: RepositoryPollUpdate,
    now: number,
  ): RepositoryState => atomic(() => {
    if (update.kind === "initialize") {
      store.initializeRepository(identity, update.startPrNumber, now);
    } else if (update.kind === "snapshot") {
      if (needRepository(identity).startPrNumber === null) {
        throw new Error("Repository initialization has not completed.");
      }
      const observedNumbers = new Set<number>();
      for (const observation of update.observations) {
        if (observedNumbers.has(observation.number)) {
          throw new Error(`A repository snapshot contains duplicate PR ${observation.number}.`);
        }
        observedNumbers.add(observation.number);
        store.observePullRequest(identity, observation, now);
      }
    } else {
      throw new Error("Unsupported repository poll update.");
    }
    return store.recordPollSuccess(identity, now);
  });
  return { ...store, applyRepositoryPoll };
};

export type Store = ReturnType<typeof openStore>;
