import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

const directory = process.env.DAYNIGHT_E2E_DIRECTORY;
const args = process.argv.slice(2);
const prompt = readFileSync(0, "utf8");
const target = JSON.parse(prompt.split("\n").find((line) => line.startsWith('{"host":')));
const sessionFlag = args.find((argument) => /^--(?:session-id|resume)=/.test(argument));
if (sessionFlag === undefined) throw new Error("The CLI did not supply a session identity.");
const session = sessionFlag.slice(sessionFlag.indexOf("=") + 1);
const history = path.join(process.env.COPILOT_HOME, "session-state", session);
mkdirSync(history, { recursive: true });
const stable = `daynight review=${target.reviewId} revision=${target.revision} head=${target.headSha}`;
const endpoint = `repos/${target.repository}/pulls/${target.pullRequest}`;
const gh = (method, endpoint, payload) => JSON.parse(execFileSync("gh", ["api", "--method", method, "--hostname", target.host, endpoint,
  ...(payload === undefined ? [] : ["--input", "-"])], { encoding: "utf8", env: { ...process.env, DAYNIGHT_E2E_PUBLISHER: "copilot-fixture" }, ...(payload === undefined ? {} : { input: JSON.stringify(payload) }) }));
const current = gh("GET", endpoint);
if (current.state !== "open" || current.draft || current.head.sha !== target.headSha || current.base.ref !== target.baseBranch) throw new Error("The fixture agent observed a stale target.");
const previous = gh("GET", `${endpoint}/reviews`).find((item) => item.body.includes(stable));
const event = target.pullRequest === 11 && target.revision === 3 ? "COMMENT" : "APPROVE";
if (previous === undefined) gh("POST", `${endpoint}/reviews`, {
  commit_id: target.headSha, body: `Copilot: ${stable}`, event,
  ...(event === "COMMENT" ? { comments: [{ path: "review.txt", line: 1, side: "RIGHT", body: "Copilot: Major fixture finding." }] } : {}),
});
const record = {
  target, args, session, prompt, cwd: process.cwd(),
  head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  reviewFile: readFileSync("review.txt", "utf8"),
  reconciled: previous !== undefined,
};
mkdirSync(path.join(directory, "agents"), { recursive: true });
const identity = randomUUID();
const pending = path.join(directory, "agents", `${identity}.pending`);
writeFileSync(pending, JSON.stringify(record), { flag: "wx" });
renameSync(pending, path.join(directory, "agents", `${identity}.json`));
writeFileSync(path.join(history, `${randomUUID()}.json`), JSON.stringify({ reviewId: target.reviewId, revision: target.revision }), { flag: "wx" });
// The first publication deliberately succeeds without the required final marker.
if (event === "COMMENT" && previous === undefined) process.stdout.write("Publication succeeded; confirmation was interrupted.\n");
else process.stdout.write(`PR ${target.pullRequest} Review Completed\n`);
