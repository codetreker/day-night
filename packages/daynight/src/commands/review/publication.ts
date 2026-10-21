import type { PullRequestReviewSnapshot, ReviewState } from "./model.js";

export type PublicationIdentityFormat = "line" | "legacy";
export type ReviewPublication = { publisherId: string; outcome: "approved" | "commented"; remoteReviewId: string; threadIds: string[] };
export const reviewPublicationIdentity = (review: Pick<ReviewState, "id" | "revision" | "headSha">): string =>
  `daynight review=${review.id} revision=${review.revision} head=${review.headSha}`;

const hasIdentity = (body: string, identity: string): boolean => body.split(/\r?\n/).some((line) =>
  line === identity || line === `<!-- ${identity} -->`);

const hasLegacyIdentity = (body: string, identity: string): boolean => {
  const offset = body.indexOf(identity);
  if (offset < 0) return false;
  const before = offset === 0 ? "" : body[offset - 1]!;
  const after = body[offset + identity.length] ?? "";
  return !/[A-Za-z0-9_-]/.test(before) && !/[A-Za-z0-9_-]/.test(after);
};

export const findReviewPublication = (review: ReviewState, snapshot: PullRequestReviewSnapshot, publisherId: string, identityFormat: PublicationIdentityFormat = "line"): ReviewPublication | null => {
  const identity = reviewPublicationIdentity(review);
  const published = snapshot.reviews.filter((item) => item.authorId === publisherId && item.headSha === review.headSha && (identityFormat === "legacy" ? hasLegacyIdentity(item.body, identity) : hasIdentity(item.body, identity)));
  const approval = published.findLast((item) => item.state === "APPROVED");
  if (approval !== undefined) return { publisherId, outcome: "approved", remoteReviewId: approval.id, threadIds: [] };
  for (const item of [...published].reverse()) {
    if (item.state !== "COMMENTED") continue;
    const threadIds = snapshot.threads.filter((thread) => thread.reviewId === item.id).map((thread) => thread.id);
    if (threadIds.length > 0) return { publisherId, outcome: "commented", remoteReviewId: item.id, threadIds };
  }
  return null;
};

export const hasPendingReviewPublication = (review: ReviewState, snapshot: PullRequestReviewSnapshot, publisherId: string, identityFormat: PublicationIdentityFormat = "line"): boolean =>
  snapshot.reviews.some((item) => item.state === "PENDING" && item.authorId === publisherId && item.headSha === review.headSha &&
    (identityFormat === "legacy" ? hasLegacyIdentity(item.body, reviewPublicationIdentity(review)) : hasIdentity(item.body, reviewPublicationIdentity(review))));

export const findLegacyReviewPublisher = (review: ReviewState, snapshot: PullRequestReviewSnapshot): string | null => {
  const actors = new Set(snapshot.reviews.filter((item) => item.authorId !== null && item.headSha === review.headSha &&
    hasLegacyIdentity(item.body, reviewPublicationIdentity(review))).map((item) => item.authorId!));
  if (actors.size > 1) throw new Error("The migrated review identity has publications by multiple actors; its publisher cannot be adopted unambiguously.");
  return actors.size === 0 ? null : [...actors][0]!;
};

export const findLegacyReviewPublication = (review: ReviewState, snapshot: PullRequestReviewSnapshot): ReviewPublication | null => {
  for (const candidate of [...snapshot.reviews].reverse()) {
    if (candidate.authorId === null || candidate.state !== "APPROVED" || candidate.headSha !== review.headSha || !hasLegacyIdentity(candidate.body, reviewPublicationIdentity(review))) continue;
    return { publisherId: candidate.authorId, outcome: "approved", remoteReviewId: candidate.id, threadIds: [] };
  }
  return null;
};

export const hasOpenReviewConversations = (snapshot: PullRequestReviewSnapshot): boolean => {
  const pendingReviews = new Set(snapshot.reviews.filter((review) => review.state === "PENDING").map((review) => review.id));
  return snapshot.threads.some((thread) => !thread.isResolved && (thread.reviewId === null || !pendingReviews.has(thread.reviewId)));
};
