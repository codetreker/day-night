import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const directory = process.env.DAYNIGHT_E2E_DIRECTORY;
const record = (kind, data) => {
  const folder = path.join(directory, kind);
  mkdirSync(folder, { recursive: true });
  const identity = randomUUID();
  const pending = path.join(folder, `${identity}.pending`);
  writeFileSync(pending, JSON.stringify(data), { flag: "wx" });
  renameSync(pending, path.join(folder, `${identity}.json`));
};
const records = (kind) => {
  const folder = path.join(directory, kind);
  return existsSync(folder) ? readdirSync(folder).filter((file) => file.endsWith(".json")).map((file) => JSON.parse(readFileSync(path.join(folder, file), "utf8"))) : [];
};

// A renamed native Node executable keeps execFile("gh") real on Windows.
// Preloading runs before Node resolves the intentionally absent "api" entrypoint.
if (/^gh(?:\.exe)?$/i.test(path.basename(process.execPath))) {
  const args = [path.basename(process.argv[1]), ...process.argv.slice(2)];
  if (args[0] !== "api") throw new Error(`Unexpected fake gh command: ${JSON.stringify(args)}`);
  const methodIndex = args.indexOf("--method");
  const method = methodIndex === -1 ? "GET" : args[methodIndex + 1];
  const endpoint = args.find((argument) => argument.startsWith("repos/") || argument === "graphql");
  if (endpoint === undefined) throw new Error("The fake gh only accepts fixture repository API endpoints.");
  const url = new URL(endpoint, "https://fixture.invalid/");
  const state = JSON.parse(readFileSync(path.join(directory, "api.json"), "utf8"));
  if (endpoint === "graphql") {
    if (method !== "POST") throw new Error("GraphQL fixture requests must use POST.");
    const input = args[args.indexOf("--input") + 1] === "-" ? JSON.parse(readFileSync(0, "utf8")) : undefined;
    const query = input?.query ?? args.find((argument) => argument.startsWith("query="))?.slice("query=".length);
    if (typeof query !== "string") throw new Error("A fixture GraphQL query is required.");
    if (query.includes("mutation")) {
      if (process.env.DAYNIGHT_E2E_PUBLISHER !== "copilot-fixture" || !query.includes("addPullRequestReviewThread")) throw new Error("Only the fixture publisher may add native review threads.");
      const thread = input.variables.input;
      if (thread.subjectType !== "FILE" || typeof thread.path !== "string" || "line" in thread || "side" in thread) throw new Error("File threads require a file subject without a fabricated line.");
      const review = records("reviews").find((item) => item.node_id === thread.pullRequestReviewId);
      if (review?.state !== "PENDING") throw new Error("A file thread must belong to an existing pending review.");
      const created = { id: randomUUID(), reviewId: review.node_id, number: review.number, path: thread.path, subjectType: "FILE", body: thread.body };
      record("threads", created);
      record("requests", { version: state.version, endpoint, method, mutation: "addPullRequestReviewThread" });
      writeFileSync(1, `${JSON.stringify({ data: { addPullRequestReviewThread: { thread: { id: created.id } } } })}\n`);
      process.exit(0);
    }
    const owner = args.find((argument) => argument.startsWith("owner="));
    const name = args.find((argument) => argument.startsWith("name="));
    const number = Number(args.find((argument) => argument.startsWith("number="))?.slice("number=".length));
    if (owner !== "owner=fixture" || name !== "name=review-project") throw new Error("Unexpected fixture repository.");
    const pr = state.pulls.find((item) => item.number === number);
    if (pr === undefined) throw new Error("The fixture PR does not exist.");
    const target = { number, state: pr.state === "open" ? "OPEN" : pr.merged_at === null ? "CLOSED" : "MERGED",
      isDraft: pr.draft, headRefOid: pr.head.sha, baseRefName: pr.base.ref };
    const connection = (nodes) => ({ nodes, totalCount: nodes.length, pageInfo: { hasNextPage: false, endCursor: null } });
    const result = query.includes("reviewThreads") ? { data: { viewer: { id: "fixture-copilot" }, repository: { databaseId: 4242, pullRequest: { ...target,
      reviews: connection(records("reviews").filter((item) => item.number === number).map((item) => ({ id: item.node_id, author: { id: "fixture-copilot" }, commit: { oid: item.commit_id }, body: item.body, state: item.state }))),
      reviewThreads: connection(records("threads").filter((item) => item.number === number).map((item) => ({ id: item.id, isResolved: state.resolvedThreadIds.includes(item.id), comments: { totalCount: 1, nodes: [{ replyTo: null, pullRequestReview: { id: item.reviewId } }] } }))),
    } } } } : { data: { repository: { pullRequest: { ...target,
      commits: { nodes: [{ commit: { oid: pr.head.sha, statusCheckRollup: pr.ci === null ? null : { state: pr.ci },
        checkSuites: { nodes: [], totalCount: 0, pageInfo: { hasNextPage: false, endCursor: null } } } }] }, potentialMergeCommit: null,
    } } } };
    record("requests", { version: state.version, endpoint, method, number });
    writeFileSync(1, `${args.includes("--include") ? "HTTP/2.0 200 OK\r\nContent-Type: application/json\r\n\r\n" : ""}${JSON.stringify(result)}\n`);
    process.exit(0);
  }
  const match = /^\/repos\/fixture\/review-project(?:\/pulls(?:\/(?<number>\d+)(?:\/reviews(?:\/(?<reviewId>[^/]+)\/(?<action>events|comments))?)?)?)?$/.exec(url.pathname);
  if (match === null) throw new Error(`Unexpected fake API endpoint: ${endpoint}`);
  const { number: rawNumber, reviewId, action } = match.groups;
  const number = Number(rawNumber);
  const isReviewRoute = url.pathname.includes("/reviews");
  const saveReview = (review) => {
    const folder = path.join(directory, "reviews"); mkdirSync(folder, { recursive: true });
    const pending = path.join(folder, `${randomUUID()}.pending`); writeFileSync(pending, JSON.stringify(review));
    renameSync(pending, path.join(folder, `${review.id}.json`));
  };
  let result;
  if (method === "POST") {
    if (process.env.DAYNIGHT_E2E_PUBLISHER !== "copilot-fixture") throw new Error("Only the controlled Copilot agent may publish reviews.");
    if (!isReviewRoute || (reviewId !== undefined && action !== "events") || args[args.indexOf("--input") + 1] !== "-") throw new Error("Unexpected publication.");
    const publication = JSON.parse(readFileSync(0, "utf8"));
    if (publication.event !== undefined && !["COMMENT", "APPROVE"].includes(publication.event)) throw new Error("Only pending, COMMENT and APPROVE reviews are permitted.");
    const pr = state.pulls.find((item) => item.number === number);
    const existing = reviewId === undefined ? undefined : records("reviews").find((item) => String(item.id) === reviewId);
    if (pr.state !== "open" || pr.draft || (publication.commit_id ?? existing?.commit_id) !== pr.head.sha) throw new Error("Publication target is stale.");
    if (reviewId !== undefined && existing?.state !== "PENDING") throw new Error("Only pending reviews may be submitted.");
    const id = existing?.id ?? randomUUID();
    result = { ...existing, id, node_id: existing?.node_id ?? `review-${id}`, number: pr.number, publisher: process.env.DAYNIGHT_E2E_PUBLISHER, ...publication,
      state: publication.event === "APPROVE" ? "APPROVED" : publication.event === "COMMENT" ? "COMMENTED" : "PENDING" };
    saveReview(result);
    for (const comment of publication.comments ?? []) record("threads", { id: randomUUID(), reviewId: result.node_id, number: pr.number, ...comment });
    if (publication.event !== undefined) record("publications", result);
  } else if (method === "GET") {
    if (action === "comments") {
      const review = records("reviews").find((item) => String(item.id) === reviewId);
      if (review === undefined) throw new Error("The requested fixture review does not exist.");
      result = records("threads").filter((item) => item.reviewId === review.node_id);
    } else if (isReviewRoute) result = records("reviews").filter((item) => item.number === number);
    else if (rawNumber !== undefined) result = state.pulls.find((item) => item.number === number);
    else if (url.pathname.endsWith("/pulls")) result = state.pulls.filter((item) => url.searchParams.get("state") !== "open" || item.state === "open");
    else result = { id: 4242 };
    record("requests", { version: state.version, endpoint, method });
  } else throw new Error(`Unexpected API method: ${method}`);
  if (result === undefined) throw new Error("The fixture PR does not exist.");
  const output = `${args.includes("--include") ? "HTTP/2.0 200 OK\r\nContent-Type: application/json\r\n\r\n" : ""}${JSON.stringify(result)}\n`;
  writeFileSync(1, output);
  process.exit(0);
} else if (directory !== undefined && path.basename(process.argv[1] ?? "") === "main.js") {
  const timer = setInterval(() => {
    if (existsSync(path.join(directory, "crash"))) {
      // This pre-review crash point isolates stale-lock recovery from tool termination.
      const resources = process.getActiveResourcesInfo();
      if (resources.includes("ProcessWrap")) return;
      clearInterval(timer);
      writeFileSync(path.join(directory, "crash-receipt.json"), JSON.stringify({ pid: process.pid, exitCode: 73, resources }), { flag: "wx" });
      process.exit(73);
    }
    if (existsSync(path.join(directory, "stop"))) {
      clearInterval(timer);
      process.emit("SIGINT");
    }
  }, 50);
  timer.unref();
}
