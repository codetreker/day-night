import type { PullRequestReviewSnapshot, ReviewState } from "./model.js";

export type ReviewPublication = { publisherId: string; outcome: "approved" | "commented"; remoteReviewId: string; threadIds: string[] };
export const reviewPublicationIdentity = (review: Pick<ReviewState, "id" | "revision" | "headSha">): string =>
  `daynight review=${review.id} revision=${review.revision} head=${review.headSha}`;

const hasIdentity = (body: string, identity: string): boolean => body.split(/\r?\n/).some((line) =>
  line === identity || line === `<!-- ${identity} -->`);

export const findReviewPublication = (review: ReviewState, snapshot: PullRequestReviewSnapshot, publisherId: string): ReviewPublication | null => {
  const identity = reviewPublicationIdentity(review);
  const published = snapshot.reviews.filter((item) => item.authorId === publisherId && item.headSha === review.headSha && hasIdentity(item.body, identity));
  const approval = published.findLast((item) => item.state === "APPROVED");
  if (approval !== undefined) return { publisherId, outcome: "approved", remoteReviewId: approval.id, threadIds: [] };
  for (const item of [...published].reverse()) {
    if (item.state !== "COMMENTED") continue;
    const threadIds = snapshot.threads.filter((thread) => thread.reviewId === item.id).map((thread) => thread.id);
    if (threadIds.length > 0) return { publisherId, outcome: "commented", remoteReviewId: item.id, threadIds };
  }
  return null;
};

const hasLegacyIdentity = (body: string, identity: string): boolean => {
  const offset = body.indexOf(identity);
  if (offset < 0) return false;
  const before = offset === 0 ? "" : body[offset - 1]!;
  const after = body[offset + identity.length] ?? "";
  return !/[A-Za-z0-9_-]/.test(before) && !/[A-Za-z0-9_-]/.test(after);
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
