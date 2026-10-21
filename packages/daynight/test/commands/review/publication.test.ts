import { describe, expect, it } from "vitest";
import { findLegacyReviewPublication, findReviewPublication, hasOpenReviewConversations, reviewPublicationIdentity } from "../../../src/commands/review/publication.js";
import type { PullRequestReviewSnapshot, ReviewState } from "../../../src/commands/review/model.js";

const review = { id: "00000000-0000-4000-8000-000000000001", revision: 1, headSha: "a".repeat(40) } as ReviewState;
const snapshot = (): PullRequestReviewSnapshot => ({ state: "open", draft: false, headSha: review.headSha, baseRef: "main", viewerId: "reader", reviews: [], threads: [] });

describe("review publication provenance", () => {
  it("requires the captured actor, full stable identity and captured commit", () => {
    const remote = snapshot();
    remote.reviews.push({ id: "wrong-actor", authorId: "reader", headSha: review.headSha, state: "APPROVED", body: reviewPublicationIdentity(review) },
      { id: "wrong-head", authorId: "publisher", headSha: "b".repeat(40), state: "APPROVED", body: reviewPublicationIdentity(review) },
      { id: "wrong-round", authorId: "publisher", headSha: review.headSha, state: "APPROVED", body: reviewPublicationIdentity({ ...review, revision: 2 }) });
    expect(findReviewPublication(review, remote, "publisher")).toBeNull();
    remote.reviews.push({ id: "correct", authorId: "publisher", headSha: review.headSha, state: "APPROVED", body: `<!-- ${reviewPublicationIdentity(review)} -->` });
    expect(findReviewPublication(review, remote, "publisher")).toEqual({ publisherId: "publisher", outcome: "approved", remoteReviewId: "correct", threadIds: [] });
  });

  it("requires a native thread belonging to the COMMENT, including one resolved before lookup", () => {
    const remote = snapshot();
    remote.reviews.push({ id: "comment", authorId: "publisher", headSha: review.headSha, state: "COMMENTED", body: reviewPublicationIdentity(review) });
    remote.threads.push({ id: "foreign", reviewId: "other-review", isResolved: false });
    expect(findReviewPublication(review, remote, "publisher")).toBeNull();
    remote.threads.push({ id: "resolved-fast", reviewId: "comment", isResolved: true });
    expect(findReviewPublication(review, remote, "publisher")).toMatchObject({ outcome: "commented", threadIds: ["resolved-fast"] });
  });

  it.each([
    "Stable review identity: IDENTITY",
    "Copilot reviewed this target (IDENTITY).",
    "<!-- IDENTITY -->",
  ])("migrates a historical approval whose permitted identity format was %s", (body) => {
    const remote = snapshot();
    remote.reviews.push({ id: "historical", authorId: "historical-publisher", headSha: review.headSha, state: "APPROVED", body: body.replace("IDENTITY", reviewPublicationIdentity(review)) });
    expect(findLegacyReviewPublication(review, remote)).toMatchObject({ publisherId: "historical-publisher", outcome: "approved", remoteReviewId: "historical" });
    if (!body.startsWith("<!--")) expect(findReviewPublication(review, remote, "historical-publisher")).toBeNull();
  });

  it("does not let a longer or altered legacy identity adopt a historical approval", () => {
    const remote = snapshot();
    remote.reviews.push({ id: "false-prefix", authorId: "historical-publisher", headSha: review.headSha, state: "APPROVED", body: `${reviewPublicationIdentity(review)}ff` });
    expect(findLegacyReviewPublication(review, remote)).toBeNull();
  });

  it("excludes only threads whose fully known parent review is PENDING", () => {
    const remote = snapshot();
    remote.reviews.push({ id: "draft", authorId: "reader", headSha: review.headSha, body: "", state: "PENDING" });
    remote.threads.push({ id: "private", reviewId: "draft", isResolved: false });
    expect(hasOpenReviewConversations(remote)).toBe(false);
    remote.threads.push({ id: "unknown", reviewId: "unknown-review", isResolved: false });
    expect(hasOpenReviewConversations(remote)).toBe(true);
  });
});
