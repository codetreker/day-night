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
