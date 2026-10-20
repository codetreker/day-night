import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

const directory = process.env.DAYNIGHT_E2E_DIRECTORY;
const args = process.argv.slice(2);
if (Object.keys(process.env).some((name) => name.toUpperCase() === "COPILOT_SKILLS_DIRS")) throw new Error("The CLI must clear ambient custom skill directories.");
const pluginFlag = args.find((argument) => argument.startsWith("--plugin-dir="));
if (pluginFlag === undefined) throw new Error("The CLI did not supply a plugin snapshot root.");
const rootDirectory = pluginFlag.slice("--plugin-dir=".length);
if (!path.isAbsolute(rootDirectory)) throw new Error("The CLI did not supply an absolute plugin snapshot root.");
const pluginManifest = JSON.parse(readFileSync(path.join(rootDirectory, "plugin.json"), "utf8"));
if (pluginManifest.name !== "daynight-review-bundle" || pluginManifest.version !== "1.0.0") throw new Error("The supplied plugin snapshot has invalid metadata.");
const skillDirectory = path.join(rootDirectory, "skills", "daynight-review");
const entrypoint = path.join(skillDirectory, "SKILL.md");
const contents = readFileSync(entrypoint, "utf8");
const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(contents);
if (frontmatter === null) throw new Error("The supplied skill snapshot has no frontmatter.");
const metadata = parse(frontmatter[1]);
if (metadata.name !== "daynight-review" || typeof metadata.description !== "string" || metadata.description.trim() === "") throw new Error("The supplied skill snapshot has invalid metadata.");
const skill = { rootDirectory, directory: skillDirectory, entrypoint, digest: path.basename(rootDirectory), contents,
  contentSha256: createHash("sha256").update(contents).digest("hex") };
const writeRecord = (kind, data) => {
  mkdirSync(path.join(directory, kind), { recursive: true });
  const identity = randomUUID();
  const pending = path.join(directory, kind, `${identity}.pending`);
  writeFileSync(pending, JSON.stringify(data), { flag: "wx" });
  renameSync(pending, path.join(directory, kind, `${identity}.json`));
};
if (args.includes("skill")) {
  if (args.includes("--session-id") || args.some((argument) => /^--(?:session-id|resume)=/.test(argument)) || args.slice(-3).join(" ") !== "skill list --json") throw new Error("Skill discovery must not create or resume a review session.");
  writeRecord("discoveries", { args, cwd: process.cwd(), skill });
  process.stdout.write(`${JSON.stringify([{ name: metadata.name, description: metadata.description, source: "plugin", path: skillDirectory, enabled: true }])}\n`);
  process.exit(0);
}
const prompt = readFileSync(0, "utf8");
const suppliedSkill = JSON.parse(prompt.split("\n").find((line) => line.startsWith("Daynight skill bundle: ")).slice("Daynight skill bundle: ".length));
if (!prompt.includes("/daynight-review") || suppliedSkill.name !== metadata.name || suppliedSkill.entrypoint !== entrypoint || suppliedSkill.digest !== skill.digest) throw new Error("The review prompt did not explicitly invoke the current skill snapshot.");
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
  target, args, session, prompt, cwd: process.cwd(), skill,
  head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  repositoryStatus: execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" }),
  reviewFile: readFileSync("review.txt", "utf8"),
  reconciled: previous !== undefined,
};
writeRecord("agents", record);
writeFileSync(path.join(history, `${randomUUID()}.json`), JSON.stringify({ reviewId: target.reviewId, revision: target.revision }), { flag: "wx" });
// The first publication deliberately succeeds without the required final marker.
if (event === "COMMENT" && previous === undefined) process.stdout.write("Publication succeeded; confirmation was interrupted.\n");
else process.stdout.write(`PR ${target.pullRequest} Review Completed\n`);
