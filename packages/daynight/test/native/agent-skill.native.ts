import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createInstalledCli } from "../fixtures/installed-cli.js";
import { runClaude } from "./claude.js";
import { runCodex } from "./codex.js";
import { runCopilot } from "./copilot.js";
import { createNativeFixture } from "./fixture.js";
import type { NativeHostName, NativeHostResult } from "./host.js";
import { createRecoveryFixture } from "./recovery.js";
import { createNativeService } from "./service.js";
import type { NativeServiceCleanup } from "./service.js";

const workspace = path.resolve(import.meta.dirname, "../../../..");
const hostNames: readonly NativeHostName[] = ["codex", "copilot", "claude"];
const scopes = ["user", "project"] as const;
const selected = <T extends string>(name: string, values: readonly T[]): readonly T[] => {
  const value = process.env[name];
  if (value === undefined) return values;
  if (!values.includes(value as T)) throw new Error(`${name} must be one of ${values.join(", ")}.`);
  return [value as T];
};
const hosts = selected("DAYNIGHT_NATIVE_HOST", hostNames);
const selectedScopes = selected("DAYNIGHT_NATIVE_SCOPE", scopes);
const recoveryKinds = ["unlinked", "ambiguous", "service_failure"] as const;
const recoveryOnly = process.env.DAYNIGHT_NATIVE_RECOVERY !== undefined;
const recoverySelection = selected("DAYNIGHT_NATIVE_RECOVERY", recoveryKinds);
const cases = recoveryOnly ? [] : selectedScopes.flatMap((scope) => hosts.map((host) => ({ host, scope })));
const recoveryCases = recoveryOnly || process.env.DAYNIGHT_NATIVE_HOST === undefined && process.env.DAYNIGHT_NATIVE_SCOPE === undefined ? recoverySelection : [];
const expectedCases = [...cases.map(({ host, scope }) => `${host}/${scope}`), ...recoveryCases.map((kind) => `codex/recovery/${kind}`)];
const runners = { codex: runCodex, copilot: runCopilot, claude: runClaude };
const results: Record<string, unknown>[] = [];
const failures: string[] = [];
let installed: Awaited<ReturnType<typeof createInstalledCli>> | undefined;
let service: Awaited<ReturnType<typeof createNativeService>> | undefined;
let root: string | undefined;
let openPrUrl: string;
let mergedPrUrl: string;
let normalCasesFinished = Promise.resolve();

const verifiedPr = (name: string, state: string): string => {
  const url = process.env[name];
  if (url === undefined || !/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/[1-9][0-9]*$/.test(url)) throw new Error(`${name} must identify an authorized GitHub delivery PR.`);
  const facts = JSON.parse(execFileSync("gh", ["pr", "view", url, "--json", "url,state,mergeCommit"], { encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] })) as { url: string; state: string; mergeCommit: { oid: string } | null };
  if (facts.state !== state || state === "MERGED" && facts.mergeCommit === null) throw new Error(`${name} must be platform-confirmed ${state}.`);
  return facts.url;
};

beforeAll(async () => {
  if (process.platform !== "linux") throw new Error("Live native Agent acceptance requires Linux, Docker and configured native hosts.");
  openPrUrl = verifiedPr("DAYNIGHT_NATIVE_OPEN_PR", "OPEN");
  mergedPrUrl = verifiedPr("DAYNIGHT_NATIVE_MERGED_PR", "MERGED");
  await mkdir(path.join(workspace, ".tmp"), { recursive: true });
  root = await mkdtemp(path.join(workspace, ".tmp/native-agent-skill-"));
  installed = await createInstalledCli();
  service = await createNativeService(root);
});

const runWorkflow = async ({ host, scope }: typeof cases[number]): Promise<void> => {
  if (root === undefined || installed === undefined || service === undefined) throw new Error("Native acceptance setup did not complete.");
  const fixture = await createNativeFixture({ rootDirectory: path.join(root, `${host}-${scope}`), receipt: installed.receipt, serviceUrl: service.url, host, scope, openPrUrl, mergedPrUrl, expectUncertainCreate: true });
  service.dropNextTaskCreateResponse(fixture.projectId);
  let failure: unknown;
  let native: NativeHostResult | undefined;
  try {
    const base = scope === "user" ? fixture.homeDirectory : fixture.workingDirectory;
    const skillEntrypoints = [".agents", ".claude"].map((directory) => path.join(base, directory, "skills/daynight/SKILL.md"));
    const expectedSkillContents = await readFile(skillEntrypoints[0]!, "utf8");
    native = await runners[host]({ ...fixture, fixtureDirectory: path.join(root, `${host}-${scope}`), skillEntrypoints, expectedSkillContents, timeoutMs: 300_000 });
    const observations = await fixture.verify(native);
    expect(service.faults.some((fault) => fault.kind === "drop_task_create_response" && fault.projectId === fixture.projectId && fault.state === "applied" && fault.upstreamStatus === 201 && fault.afterCommit && fault.appliedHits === 1)).toBe(true);
    results.push({ host, scope, skillEntrypointSha256: createHash("sha256").update(expectedSkillContents).digest("hex"), native, observations });
  } catch (cause) {
    failure = cause;
    failures.push(`${host}/${scope}: ${cause instanceof Error ? cause.message : String(cause)}`);
    if (native !== undefined) results.push({ host, scope, native, failed: true });
    throw cause;
  } finally {
    try { await fixture.cleanup(); }
    catch (cleanupError) { failures.push(`${host}/${scope}: fixture cleanup failed`); throw failure === undefined ? cleanupError : new AggregateError([failure, cleanupError], "Native workflow and fixture cleanup failed."); }
  }
};

if (cases.length !== 0) it("automatically loads the installed skill and maintains real tasks in the selected workflow matrix", async () => {
  const pending = [...cases];
  const errors: unknown[] = [];
  const workers = Array.from({ length: Math.min(3, cases.length) }, async () => {
    let current: typeof cases[number] | undefined;
    while ((current = pending.shift()) !== undefined) {
      const { host, scope } = current;
      process.stdout.write(`Native workflow started: ${host}/${scope}\n`);
      try { await runWorkflow(current); process.stdout.write(`Native workflow passed: ${host}/${scope}\n`); }
      catch (cause) { errors.push(cause); }
    }
  });
  normalCasesFinished = Promise.all(workers).then(() => {});
  await normalCasesFinished;
  if (errors.length !== 0) throw new AggregateError(errors, "Selected native workflows failed.");
});

if (recoveryCases.length !== 0) it.each(recoveryCases)("preserves real project recovery failures: %s", async (kind) => {
  await normalCasesFinished;
  if (root === undefined || installed === undefined || service === undefined) throw new Error("Native acceptance setup did not complete.");
  const fixture = await createRecoveryFixture({ rootDirectory: path.join(root, `recovery-${kind}`), receipt: installed.receipt, service, kind });
  let failure: unknown;
  let native: NativeHostResult | undefined;
  try {
    native = await runCodex({ ...fixture, timeoutMs: 300_000 });
    const observations = await fixture.verify(native);
    results.push({ host: "codex", recovery: kind, native, observations });
  } catch (cause) {
    failure = cause;
    failures.push(`codex/recovery/${kind}: ${cause instanceof Error ? cause.message : String(cause)}`);
    if (native !== undefined) results.push({ host: "codex", recovery: kind, native, failed: true });
    throw cause;
  } finally {
    try { await fixture.cleanup(); }
    catch (cleanupError) { failures.push(`recovery/${kind}: fixture cleanup failed`); throw failure === undefined ? cleanupError : new AggregateError([failure, cleanupError], "Native recovery and fixture cleanup failed."); }
  }
});

afterAll(async () => {
  const cleanupFailures: unknown[] = [];
  let serviceCleanup: NativeServiceCleanup | undefined;
  if (service !== undefined) try { serviceCleanup = await service.cleanup(); } catch (cause) { cleanupFailures.push(cause); }
  if (installed !== undefined) try { await installed.cleanup(); } catch (cause) { cleanupFailures.push(cause); }
  if (root !== undefined) try { await rm(root, { recursive: true, force: true }); } catch (cause) { cleanupFailures.push(cause); }
  const receipt = {
    schemaVersion: 1, success: failures.length === 0 && cleanupFailures.length === 0 && results.length === expectedCases.length,
    selection: expectedCases, platform: process.platform, nodeVersion: process.version,
    artifact: installed === undefined ? null : { packageVersion: installed.receipt.packageVersion, tarballSha256: installed.receipt.tarballSha256, entrySha256: installed.receipt.entrySha256, source: installed.receipt.source },
    service: service?.identity, requests: service?.observations, faults: service?.faults, cases: results, failures,
    cleanup: { service: serviceCleanup, errors: cleanupFailures.length },
  };
  await mkdir(path.join(workspace, ".tmp"), { recursive: true });
  const selectionName = recoveryOnly ? `recovery-${process.env.DAYNIGHT_NATIVE_RECOVERY}` : `${process.env.DAYNIGHT_NATIVE_HOST ?? "all"}-${process.env.DAYNIGHT_NATIVE_SCOPE ?? "all"}`;
  await writeFile(path.join(workspace, `.tmp/native-agent-skill-${selectionName}-evidence.json`), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  if (cleanupFailures.length !== 0) throw new AggregateError(cleanupFailures, "Native Agent acceptance cleanup failed.");
  expect(failures).toEqual([]);
});
