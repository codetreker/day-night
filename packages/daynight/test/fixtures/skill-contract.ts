import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";

type Resource = { readonly path: string; readonly sha256: string; readonly localReferences: readonly string[] };
export type InstalledSkillContract = {
  readonly documents: ReadonlyMap<string, string>;
  readonly resources: readonly Resource[];
  readonly metadata: { readonly name: string; readonly description: string };
};

const prose = (content: string): string => {
  let fence: { marker: string; length: number } | undefined;
  return content.split(/\r?\n/).filter((line) => {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker !== undefined) {
      if (fence === undefined) fence = { marker: marker[0]!, length: marker.length };
      else if (marker[0] === fence.marker && marker.length >= fence.length && line.trim() === marker) fence = undefined;
      return false;
    }
    return fence === undefined;
  }).join("\n");
};
const contained = (root: string, file: string): boolean => {
  const relative = path.relative(root, file);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

export const inspectInstalledSkill = async (directory: string): Promise<InstalledSkillContract> => {
  const root = await realpath(directory);
  const documents = new Map<string, string>();
  const resources: Resource[] = [];
  const visit = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) { await visit(file); continue; }
      const relative = path.relative(root, file).replaceAll("\\", "/");
      const bytes = await readFile(file);
      const localReferences: string[] = [];
      if (entry.name.endsWith(".md")) {
        const content = bytes.toString("utf8");
        documents.set(relative, content);
        for (const match of prose(content).matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
          const target = match[1]!;
          if (target.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
          const resource = path.resolve(path.dirname(file), target.split("#")[0]!);
          assert.ok(contained(root, resource), `${relative} links outside the installed bundle: ${target}`);
          assert.ok(contained(root, await realpath(resource)), `${relative} resolves outside the installed bundle: ${target}`);
          localReferences.push(target);
        }
      }
      resources.push({ path: relative, sha256: createHash("sha256").update(bytes).digest("hex"), localReferences });
    }
  };
  await visit(root);
  resources.sort((left, right) => left.path.localeCompare(right.path));
  const entrypoint = documents.get("SKILL.md");
  assert.equal(typeof entrypoint, "string", "The installed bundle contains SKILL.md.");
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(entrypoint!);
  assert.notEqual(frontmatter, null, "The installed skill has YAML frontmatter.");
  const metadata: unknown = parseYaml(frontmatter![1]!);
  assert.ok(typeof metadata === "object" && metadata !== null && !Array.isArray(metadata));
  assert.ok("name" in metadata && metadata.name === "using-daynight");
  assert.ok("description" in metadata && typeof metadata.description === "string" && metadata.description.trim().length > 0);
  return { documents, resources, metadata: { name: metadata.name, description: metadata.description } };
};

type Proposition = { readonly resource: string; readonly section: string; readonly requires: readonly RegExp[] };
type InstructionScenario = {
  readonly id: string;
  readonly input: string;
  readonly obligation: string;
  readonly propositions: readonly Proposition[];
};

export const instructionScenarios: readonly InstructionScenario[] = [
  {
    id: "registration-without-approval",
    input: "Creation is authorized and all task artifacts are readable; approval was not authorized.",
    obligation: "Register proposed work, verify owned resources, and return with approval pending.",
    propositions: [
      { resource: "references/create-task.md", section: "## Register and verify", requires: [/Create new tasks in `proposed`/, /Read back each complete task, its attachment inventory and required contents/, /Without separate explicit approval authorization, leave registered work proposed/, /Return after verified registration without selecting or executing a task/] },
      { resource: "SKILL.md", section: "## Shared constraints", requires: [/Create tasks only with explicit permission for their scope/, /Creation produces `proposed` for every normal task and Goal stage/] },
    ],
  },
  {
    id: "proposed-run-request",
    input: "run-task or autopilot is requested for a proposed task without approval authority.",
    obligation: "Keep execution pending; execution and automation requests do not grant approval.",
    propositions: [
      { resource: "references/run-task.md", section: "## Establish the task and stage", requires: [/For `proposed`, keep execution pending approval/, /A run request or autopilot activation does not authorize approval/] },
      { resource: "references/autopilot.md", section: "## Select one related task", requires: [/Autopilot never auto-approves proposed work/, /permission to execute do not authorize task approval/] },
    ],
  },
  {
    id: "explicit-scoped-approval",
    input: "The user authorizes approval for one task or a stated Goal-task scope.",
    obligation: "Review that scope and use the exact observed version; approval adds no delivery authority.",
    propositions: [
      { resource: "references/run-task.md", section: "## Establish the task and stage", requires: [/Only if the user explicitly authorized approval of this task or stated scope, review its current content/, /`task approve` with that exact observed version/, /Approval does not expand implementation or delivery authorization/] },
      { resource: "SKILL.md", section: "## Shared constraints", requires: [/Approve only with explicit user authorization for that task or stated scope/, /Explicit approval may cover the stated Goal tasks; use each reviewed task's exact version/, /Approval grants no execution or delivery permission/] },
    ],
  },
  {
    id: "approved-ready-claim",
    input: "An approved ready todo has complete prerequisites and stage inputs, with execution authorized.",
    obligation: "Claim its decision version and confirm in_progress before work begins.",
    propositions: [
      { resource: "references/run-task.md", section: "## Establish the task and stage", requires: [/For ready `todo`, begin only when dependencies are done, required stage inputs are complete and the work is authorized/, /Use `task claim` with the exact version observed for that decision and confirm in_progress before starting/] },
      { resource: "references/autopilot.md", section: "## Select one related task", requires: [/Readiness checks prerequisites, not stage artifact completeness or execution authorization/, /claims the version observed for that decision before starting/] },
    ],
  },
  {
    id: "resume-existing-work",
    input: "A checkpoint identifies an existing in_progress task after interruption.",
    obligation: "Recover its actual work and identity; in_progress is not a claim lock or arbitrary selection.",
    propositions: [
      { resource: "references/run-task.md", section: "## Establish the task and stage", requires: [/For `in_progress`, recover existing work and coordinate/, /the state is not an assignee lock or lease/, /Preserve the requested task ID through recovery and waiting/] },
      { resource: "references/autopilot.md", section: "## Restore the current target", requires: [/Resume this session's current task before selecting new work/, /An arbitrary `in_progress` task is not this session's target/] },
    ],
  },
  {
    id: "conflict-needs-new-decision",
    input: "A write using a previously reviewed version returns a conflict.",
    obligation: "Reread and reconsider rather than changing the version and replaying automatically.",
    propositions: [
      { resource: "references/handbook.md", section: "**Task concurrency.**", requires: [/the exact version read for that decision using `--if-version`/, /Preserve full int64 decimal digits without numeric rounding/, /On a conflict, reread and reconsider/, /not merely a newer version/, /Never retry a mutation automatically/] },
      { resource: "references/run-task.md", section: "## Establish the task and stage", requires: [/A stale version or changed prerequisite requires rereading and reconsidering, with no automatic claim retry/] },
    ],
  },
  {
    id: "unknown-write-outcome",
    input: "A mutation response is lost or cancelled after dispatch.",
    obligation: "Preserve the failure and resource identity, then reconcile real state before another mutation.",
    propositions: [
      { resource: "references/handbook.md", section: "**Unconfirmed writes.**", requires: [/A timeout, cancellation or lost response may follow an applied change/, /Read back current task fields or attachment contents before another mutation/, /cancellation does not prove rollback/, /For an unconfirmed create, establish identity from complete fields and operation context/, /matching title or an empty lookup alone is insufficient/, /Preserve actual errors and resource IDs/, /rather than reporting success or blindly resending a write/] },
      { resource: "references/handbook.md", section: "**Attachment independence.**", requires: [/Attachment changes do not change the task's version, status, or update timestamp/, /Task versions therefore cannot protect attachment writes/] },
      { resource: "SKILL.md", section: "## Shared constraints", requires: [/reconcile uncertain results before further mutations, and preserve actual failures/] },
    ],
  },
  {
    id: "open-pr-retains-task",
    input: "Acceptance passes but a required PR is open, or the user requests keeping it for review.",
    obligation: "Keep in_progress and the checkpoint; neither auto-merge nor complete to unlock successors.",
    propositions: [
      { resource: "references/run-task.md", section: "## Confirm completion or return waiting", requires: [/passing CI, approved review, and an open PR do not satisfy this condition/, /If the user requests an open PR for review or forbids merging/, /preserve `in_progress` and the waiting checkpoint/, /Do not enable auto-merge/, /Do not declare completion or select other work to bypass a wait/] },
      { resource: "references/autopilot.md", section: "## Advance serially and accept the scope", requires: [/An explicit no-merge or user-review requirement is such a wait/, /never permits auto-merge or marking the task done/, /Return without replacing the target/] },
    ],
  },
  {
    id: "accepted-completion",
    input: "All stage acceptance and required authorized PR merges are confirmed, or there is no PR delivery path.",
    obligation: "Record readable evidence, reread in_progress and complete its observed version; stage completion is bounded.",
    propositions: [
      { resource: "references/run-task.md", section: "## Confirm completion or return waiting", requires: [/every necessary delivery PR is merged/, /Completion rules grant no merge, deployment, external communication, or mainline push permission/, /For tasks without a development or PR delivery path, use their stated stage acceptance/, /confirm required evidence is recorded and readable/, /reread the complete in-progress task and use `task complete` with its exact observed version/, /Only service confirmation establishes the status update/, /Neither establishes whole-Goal completion/] },
      { resource: "references/goal.md", section: "## Execute the appropriate stage", requires: [/Completion satisfies dependencies but never approves the next stage/] },
    ],
  },
  {
    id: "markdown-resource-ownership",
    input: "A Markdown brief links its own plan and references a prototype owned by another task.",
    obligation: "Keep a self-contained brief and one detailed owner; resolve real resources from the proper task or document base.",
    propositions: [
      { resource: "references/create-task.md", section: "## Write task-specific content", requires: [/self-contained Markdown description/, /without maintaining a second complete plan in the description/, /primary Markdown must contain \*\*Solution\*\* and \*\*Acceptance criteria\*\*/, /Consumers identify the source task ID and attachment path and confirm the contents/, /Do not upload the same whole packet to every task/] },
      { resource: "references/create-task.md", section: "## Author Markdown", requires: [/A relative link or image in a description starts at this task's attachment root/, /A link inside a Markdown attachment starts at that file's directory/, /Confirm an upload and read back its contents before adding its link/, /Use these paths only when those files actually belong to that task/, /A Goal stage that produces a prototype links it only after producing and confirming it/] },
      { resource: "references/handbook.md", section: "**Markdown descriptions.**", requires: [/reads preserve the original string, including line breaks and fenced code/, /Shared inputs retain their source task ID and path or verified immutable repository URL/, /they are not cross-task relative links/] },
    ],
  },
];

export const verifyInstructionScenario = (bundle: InstalledSkillContract, scenario: InstructionScenario): readonly string[] => {
  const checked: string[] = [];
  for (const proposition of scenario.propositions) {
    const document = bundle.documents.get(proposition.resource);
    assert.equal(typeof document, "string", `Installed scenario ${scenario.id} requires ${proposition.resource}.`);
    const normalized = document!.replaceAll("\r\n", "\n");
    const start = normalized.indexOf(proposition.section);
    assert.ok(start >= 0, `${proposition.resource} contains ${proposition.section}.`);
    const following = normalized.slice(start + proposition.section.length);
    const end = following.search(proposition.section.startsWith("## ") ? /\n## / : /\n\n\*\*[^*]+\.\*\*/);
    const section = following.slice(0, end === -1 ? undefined : end).replaceAll(/\s+/g, " ");
    for (const requirement of proposition.requires) assert.match(section, requirement, `${scenario.id}: ${scenario.obligation} (${proposition.resource} / ${proposition.section})`);
    checked.push(`${proposition.resource} / ${proposition.section}`);
  }
  return checked;
};
